/**
 * CrawlerService — FASE 1 completa (§9, §34 Hybrid preferido, §36 rate limiting).
 *
 * - HTTP primero (CheerioCrawler): rápido, bajo consumo.
 * - Browser (PlaywrightCrawler) cuando se detecta SPA / contenido dinámico / thin content.
 * - RequestQueue + SessionPool + reintentos + concurrencia configurable.
 * - failedRequestHandler con stats; nunca lanza eval() libre.
 * - Seguridad §37: bloquea hosts privados / metadata endpoints antes de encolar.
 */
import { CheerioCrawler, PlaywrightCrawler, RequestQueue } from 'crawlee';
import { chromium } from 'playwright';
import { assertSafeUrl } from '@ai-scraper/security';

/** Acción browser delegada por el ExecutionEngine (ETAPA 3, §34). */
export interface BrowserAction {
  kind: 'click' | 'scroll';
  selector?: string;
}

export interface BrowserResult {
  html: string;
  url: string;
  title: string;
}

let queueSeq = 0;
async function freshQueue() {
  queueSeq += 1;
  return RequestQueue.open(`q-${Date.now()}-${queueSeq}-${Math.floor(Math.random() * 1e6)}`);
}

export type CrawlMode = 'http' | 'browser' | 'hybrid';

export interface CrawlInput {
  url: string;
  mode?: CrawlMode;
  maxRequests?: number;
  maxDepth?: number;
  maxConcurrency?: number;
  requestTimeoutSecs?: number;
  maxRetries?: number;
  sameDomainOnly?: boolean;
  /** Rate limiting §36: peticiones/minuto por worker (env CRAWLEE_MAX_REQUESTS_PER_MINUTE). */
  maxRequestsPerMinute?: number;
}

function envRequestsPerMinute(): number | undefined {
  const n = Number(process.env.CRAWLEE_MAX_REQUESTS_PER_MINUTE ?? '');
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export interface DiscoveredElement {
  type: string;
  selector: string;
  text: string;
}

export interface ElementCount {
  selector: string;
  count: number;
}

export interface CrawledPage {
  url: string;
  title: string;
  htmlLength: number;
  statusCode?: number;
  links: Array<{ text: string; href: string }>;
  elements: DiscoveredElement[];
  /** Conteo por selector candidato (para fingerprint/estructura de la radiografía). */
  elementCounts: ElementCount[];
  /** Hash del HTML (detección de cambios / drift). */
  htmlHash: string;
  textSnippet: string;
  usedBrowser: boolean;
}

export interface CrawlStats {
  pagesOk: number;
  pagesFailed: number;
  usedBrowser: boolean;
  durationMs: number;
}

/** Selectores candidatos (heurística agnóstica §6). */
export const CANDIDATE_SELECTORS = [
  '.product-card',
  '.product',
  '[data-product]',
  '[data-testid*="product"]',
  '.card',
  'article',
  'li:has(.price), li:has([class*="price"])',
  '.item',
];

/** Hash estable y barato del HTML (no criptográfico; solo detección de cambios). */
export function hashHtml(html: string): string {
  let hash = 0;
  for (let i = 0; i < html.length; i++) {
    hash = ((hash << 5) - hash + html.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/** Seguridad §37 centralizada en @ai-scraper/security (ETAPA 2). */

/** Heurística agnóstica §6: detectar tarjetas de listado sin conocer el CMS. */
function discoverElements(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $: any,
): DiscoveredElement[] {
  const out: DiscoveredElement[] = [];
  for (const sel of CANDIDATE_SELECTORS) {
    try {
      const found = $(sel);
      if (!found || found.length === 0 || found.length > 200) continue;
      found.each((_: number, el: unknown) => {
        if (out.length >= 80) return false;
        const text = $(el).text().replace(/\s+/g, ' ').trim().slice(0, 120);
        if (text.length < 3) return;
        const cls = $(el).attr('class');
        const selector = cls ? `.${String(cls).trim().split(/\s+/)[0]}` : sel;
        out.push({ type: guessType(text), selector, text });
      });
      if (out.length >= 20) break;
    } catch {
      continue;
    }
  }
  return out.slice(0, 80);
}

/** Conteo por selector candidato (cheerio). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function countElements($: any): ElementCount[] {
  const out: ElementCount[] = [];
  for (const sel of CANDIDATE_SELECTORS) {
    try {
      const n = $(sel).length as number;
      if (n > 0) out.push({ selector: sel, count: n });
    } catch {
      /* selector inválido */
    }
  }
  return out;
}

function guessType(text: string): string {
  if (/[$€£]\s?\d|USD|EUR|precio|price/i.test(text)) return 'product';
  if (/noticia|news|autor|publicado/i.test(text)) return 'article';
  return 'element';
}

function extractLinks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $: any,
  baseUrl: string,
): CrawledPage['links'] {
  const links: CrawledPage['links'] = [];
  try {
    $('a[href]').each((_: number, el: unknown) => {
      if (links.length >= 100) return false;
      const rawHref = $(el).attr('href');
      if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:')) return;
      let href: string;
      try {
        href = new URL(rawHref, baseUrl).toString();
      } catch {
        return;
      }
      const text = $(el).text().replace(/\s+/g, ' ').trim().slice(0, 120);
      links.push({ text, href });
    });
  } catch {
    /* ignore */
  }
  return links;
}

export class CrawlerService {
  async crawl(input: CrawlInput): Promise<CrawledPage[]> {
    const { pages } = await this.crawlDetailed(input);
    return pages;
  }

  async crawlDetailed(input: CrawlInput): Promise<{ pages: CrawledPage[]; stats: CrawlStats }> {
    const started = Date.now();
    await assertSafeUrl(input.url);
    const mode = input.mode ?? 'hybrid';

    if (mode === 'browser') {
      const pages = await this.crawlWithBrowser(input);
      return {
        pages,
        stats: { pagesOk: pages.length, pagesFailed: 0, usedBrowser: true, durationMs: Date.now() - started },
      };
    }

    const httpPages = await this.crawlWithHttp(input);
    if (mode === 'http') {
      return {
        pages: httpPages.pages,
        stats: {
          pagesOk: httpPages.pages.length,
          pagesFailed: httpPages.failed,
          usedBrowser: false,
          durationMs: Date.now() - started,
        },
      };
    }

    // Hybrid §34: escalar a browser si HTTP trae contenido pobre (SPA / JS-render).
    const thin =
      httpPages.pages.length === 0 ||
      httpPages.pages.every((p) => p.links.length < 3 && p.htmlLength < 5000);
    if (thin) {
      const browserPages = await this.crawlWithBrowser(input);
      return {
        pages: browserPages,
        stats: {
          pagesOk: browserPages.length,
          pagesFailed: 0,
          usedBrowser: true,
          durationMs: Date.now() - started,
        },
      };
    }
    return {
      pages: httpPages.pages,
      stats: {
        pagesOk: httpPages.pages.length,
        pagesFailed: httpPages.failed,
        usedBrowser: false,
        durationMs: Date.now() - started,
      },
    };
  }

  /**
   * Interacción puntual con browser real (ETAPA 3, §34).
   * El ExecutionEngine delega aquí CLICK no-enlace y SCROLL: se abre
   * Chromium, se ejecuta la acción y se devuelve el HTML resultante
   * para que el engine lo cargue en Cheerio y siga en HTTP.
   */
  async interact(url: string, action: BrowserAction): Promise<BrowserResult> {
    await assertSafeUrl(url);
    const browser = await chromium.launch({ headless: process.env.CRAWLEE_HEADLESS !== 'false' });
    try {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (action.kind === 'click' && action.selector) {
        await page.click(action.selector, { timeout: 10000 });
        await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => undefined);
        await page.waitForTimeout(800).catch(() => undefined);
      } else {
        // scroll: disparar lazy-load / infinite-scroll inicial (§59)
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => undefined);
        await page.waitForTimeout(1200).catch(() => undefined);
      }
      const html = await page.content().catch(() => '');
      const title = (await page.title().catch(() => ''))?.slice(0, 200) ?? '';
      return { html, url: page.url(), title };
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  /**
   * Inspección de UNA sola página (para el agent loop §47 observe).
   * No encola enlaces: devuelve contexto reducido §23.
   */
  async inspectSinglePage(url: string, mode: CrawlMode = 'http'): Promise<CrawledPage> {
    await assertSafeUrl(url);
    const pages =
      mode === 'browser'
        ? await this.crawlWithBrowser({ url, maxRequests: 1, maxDepth: 0 })
        : await (async () => {
            const r = await this.crawlWithHttp({ url, maxRequests: 1, maxDepth: 0 });
            return r.pages;
          })();
    if (pages.length === 0) throw new Error(`Sin contenido inspeccionable: ${url}`);
    return pages[0]!;
  }

  private async crawlWithHttp(input: CrawlInput): Promise<{ pages: CrawledPage[]; failed: number }> {
    const pages: CrawledPage[] = [];
    let failed = 0;
    const maxDepth = input.maxDepth ?? 1;
    const requestQueue = await freshQueue();
    const crawler = new CheerioCrawler({
      requestQueue,
      maxRequestsPerCrawl: input.maxRequests ?? 20,
      maxConcurrency: input.maxConcurrency ?? Number(process.env.CRAWLEE_MAX_CONCURRENCY ?? 5),
      maxRequestsPerMinute: input.maxRequestsPerMinute ?? envRequestsPerMinute(),
      maxRequestRetries: input.maxRetries ?? 3,
      requestHandlerTimeoutSecs: input.requestTimeoutSecs ?? 30,
      useSessionPool: true,
      sessionPoolOptions: { maxPoolSize: 20 },
      async requestHandler({ request, $, enqueueLinks, log }) {
        const title = $('title').first().text().trim().slice(0, 200);
        const html = $.html() ?? '';
        const links = extractLinks($, request.url);
        const elements = discoverElements($);
        pages.push({
          url: request.loadedUrl ?? request.url,
          title,
          htmlLength: html.length,
          statusCode: 200,
          links,
          elements,
          elementCounts: countElements($),
          htmlHash: hashHtml(html),
          textSnippet: $('body').text().replace(/\s+/g, ' ').trim().slice(0, 2000),
          usedBrowser: false,
        });
        log.info(`[HTTP] ${request.url} (${html.length}b, ${links.length} links, ${elements.length} els)`);
        if (maxDepth > 0) {
          await enqueueLinks({
            strategy: input.sameDomainOnly === false ? 'all' : 'same-domain',
          });
        }
      },
      async failedRequestHandler({ request, log }) {
        failed += 1;
        log.warning(`[HTTP] failed ${request.url}: ${request.errorMessages?.slice(-1)[0] ?? 'unknown'}`);
      },
    });
    await crawler.run([input.url]);
    return { pages, failed };
  }

  private async crawlWithBrowser(input: CrawlInput): Promise<CrawledPage[]> {
    const pages: CrawledPage[] = [];
    const maxDepth = input.maxDepth ?? 1;
    const requestQueue = await freshQueue();
    const crawler = new PlaywrightCrawler({
      requestQueue,
      headless: process.env.CRAWLEE_HEADLESS !== 'false',
      maxRequestsPerCrawl: input.maxRequests ?? 20,
      maxConcurrency: Math.min(input.maxConcurrency ?? 3, 5),
      maxRequestsPerMinute: input.maxRequestsPerMinute ?? envRequestsPerMinute(),
      maxRequestRetries: input.maxRetries ?? 2,
      navigationTimeoutSecs: input.requestTimeoutSecs ?? 30,
      requestHandlerTimeoutSecs: (input.requestTimeoutSecs ?? 30) + 30,
      useSessionPool: true,
      sessionPoolOptions: { maxPoolSize: 10 },
      async requestHandler({ request, page, enqueueLinks, log }) {
        await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => undefined);
        // Scroll leve para disparar lazy-load / infinite-scroll inicial (§59)
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 3)).catch(() => undefined);
        await page.waitForTimeout(800).catch(() => undefined);
        const title = (await page.title()).slice(0, 200);
        const links = await page.$$eval('a[href]', (els) =>
          els.slice(0, 100).map((a) => ({
            text: ((a.textContent ?? '') as string).replace(/\s+/g, ' ').trim().slice(0, 120),
            href: a.getAttribute('href') ?? '',
          })),
        );
        const absLinks = links
          .filter((l) => l.href && !l.href.startsWith('#') && !l.href.startsWith('javascript:'))
          .map((l) => {
            try {
              return { text: l.text, href: new URL(l.href, request.url).toString() };
            } catch {
              return null;
            }
          })
          .filter((x): x is { text: string; href: string } => x !== null)
          .slice(0, 100);
        const elements = await page
          .$$eval(
            '.product-card, .product, [data-product], .card, article, .item',
            (els) =>
              els.slice(0, 80).map((el) => {
                const text = ((el.textContent ?? '') as string).replace(/\s+/g, ' ').trim().slice(0, 120);
                const cls = el.getAttribute('class');
                return {
                  type: /[$€£]\s?\d|precio|price/i.test(text) ? 'product' : 'element',
                  selector: cls ? '.' + cls.trim().split(/\s+/)[0] : el.tagName.toLowerCase(),
                  text,
                };
              }),
          )
          .catch(() => [] as DiscoveredElement[]);
        const bodyText = await page.$eval('body', (b) => b.innerText.slice(0, 2000)).catch(() => '');
        const html = await page.content().catch(() => '');
        const elementCounts = await page
          .evaluate(
            (sels: string[]) =>
              sels
                .map((s) => ({ selector: s, count: document.querySelectorAll(s).length }))
                .filter((e) => e.count > 0),
            CANDIDATE_SELECTORS as unknown as string[],
          )
          .catch(() => [] as ElementCount[]);
        pages.push({
          url: request.loadedUrl ?? request.url,
          title,
          htmlLength: html.length,
          statusCode: 200,
          links: absLinks,
          elements,
          elementCounts,
          htmlHash: hashHtml(html),
          textSnippet: bodyText,
          usedBrowser: true,
        });
        log.info(`[BROWSER] ${request.url} (${html.length}b)`);
        if (maxDepth > 0) {
          await enqueueLinks({
            strategy: input.sameDomainOnly === false ? 'all' : 'same-domain',
          });
        }
      },
    });
    await crawler.run([input.url]);
    return pages;
  }
}
