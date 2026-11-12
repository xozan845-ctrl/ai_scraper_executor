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
import type { Page } from 'playwright';
import type { CapturedNetworkResponse, RenderOptions } from '@ai-scraper/domain-scraper';
import { hashHtml } from '@ai-scraper/shared-core';
import { assertSafeUrl, createAllowlist, isAllowedHost, isBlockedHost, isPrivateHostsAllowed, safeDnsLookup } from '@ai-scraper/shared-security';
import { BrowserPool, Semaphore } from './pool';

export { hashHtml };

/** Acción browser delegada por el ExecutionEngine (ETAPA 3, §34). */
export interface BrowserAction {
  kind: 'click' | 'scroll' | 'render';
  selector?: string;
  render?: RenderOptions;
}

/** Espera a que el DOM se estabilice (hidratación de SPAs) sin depender del framework. */
async function settlePage(page: Page, minWaitMs: number, totalBudgetMs = 2500): Promise<void> {
  await page.waitForTimeout(Math.max(0, minWaitMs)).catch(() => undefined);
  let previous = '';
  let stable = 0;
  const deadline = Date.now() + totalBudgetMs;
  while (Date.now() < deadline && stable < 2) {
    const signal = await page.evaluate(() => ({
      nodes: document.querySelectorAll('*').length,
      text: (document.body?.innerText ?? '').length,
    })).catch(() => null);
    const current = signal ? `${signal.nodes}:${signal.text}` : '';
    if (current && current === previous) stable += 1;
    else { stable = 0; previous = current; }
    if (stable < 2) await page.waitForTimeout(150).catch(() => undefined);
  }
}

export interface BrowserResult {
  html: string;
  url: string;
  title: string;
  /** Respuestas JSON capturadas durante el render (XHR/fetch/GraphQL). */
  network?: CapturedNetworkResponse[];
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
  /** Headers extra (credenciales de sesión: Authorization/Cookie). */
  headers?: Record<string, string>;
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

/** Seguridad §37 centralizada en @ai-scraper/shared-security (ETAPA 2). */

/**
 * ¿El navegador debe bloquear esta URL? Cubre redirects y subrecursos (no solo la
 * URL inicial): protocolo, hosts privados/IP literal y DNS resuelto (con caché por host).
 */
async function isBlockedTarget(rawUrl: string, cache: Map<string, boolean>): Promise<boolean> {
  if (isPrivateHostsAllowed()) return false;
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return true;
  }
  if (!['http:', 'https:'].includes(u.protocol)) return false;
  const host = u.hostname.toLowerCase();
  if (isBlockedHost(host)) return true;
  const cached = cache.get(host);
  if (cached !== undefined) return cached;
  let blocked = false;
  try {
    await assertSafeUrl(u.toString());
  } catch {
    blocked = true;
  }
  cache.set(host, blocked);
  return blocked;
}

/**
 * Instala un guard de navegación en una página Playwright: aborta peticiones a hosts
 * privados/metadata, incluidos redirects y subrecursos (§37).
 */
interface NavigationRoute {
  request(): {
    url(): string;
    headers?(): Record<string, string>;
    isNavigationRequest?(): boolean;
  };
  abort(reason: string): unknown;
  continue(options?: { headers?: Record<string, string> }): unknown;
}
interface NavigationPage {
  route(pattern: string, handler: (route: NavigationRoute) => Promise<unknown>): Promise<unknown>;
}
export async function installNavigationGuard(
  page: NavigationPage,
  opts?: { allowedDomain?: string; credentialOrigin?: string; headers?: Record<string, string> },
): Promise<void> {
  const cache = new Map<string, boolean>();
  await page.route('**/*', async (route: NavigationRoute) => {
    const request = route.request();
    const rawUrl = request.url();
    if (await isBlockedTarget(rawUrl, cache)) return route.abort('blockedbyclient');
    const parsed = new URL(rawUrl);
    if (opts?.allowedDomain && request.isNavigationRequest?.() !== false && !isAllowedHost(parsed.hostname, opts.allowedDomain)) {
      return route.abort('blockedbyclient');
    }
    if (opts?.headers && opts.credentialOrigin && parsed.origin === opts.credentialOrigin) {
      return route.continue({ headers: { ...(request.headers?.() ?? {}), ...opts.headers } });
    }
    return route.continue();
  });
}

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
  private readonly pool = new BrowserPool();
  private readonly browserSemaphore = new Semaphore(Number(process.env.CRAWLEE_MAX_CONCURRENCY ?? 5));

  async crawl(input: CrawlInput): Promise<CrawledPage[]> {
    const { pages } = await this.crawlDetailed(input);
    return pages;
  }

  /** Cierra el navegador compartido (apagado graceful). */
  async close(): Promise<void> {
    await this.pool.close();
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
   * El ExecutionEngine delega aquí CLICK no-enlace y SCROLL. Reutiliza el
   * navegador del pool (no lanza uno por acción) y acota la concurrencia.
   */
  async interact(
    url: string,
    action: BrowserAction,
    opts?: { headers?: Record<string, string>; allowedDomain?: string; credentialOrigin?: string; signal?: AbortSignal },
  ): Promise<BrowserResult> {
    if (opts?.signal?.aborted) throw opts.signal.reason;
    await assertSafeUrl(url);
    const release = await this.browserSemaphore.acquire();
    let context: Awaited<ReturnType<Awaited<ReturnType<BrowserPool['acquire']>>['newContext']>> | null = null;
    try {
      const browser = await this.pool.acquire();
      context = await browser.newContext();
      const onAbort = () => void context?.close().catch(() => undefined);
      opts?.signal?.addEventListener('abort', onAbort, { once: true });
      const page = await context.newPage();
      await installNavigationGuard(page, opts);
      const captured: CapturedNetworkResponse[] = [];
      const bodyReads: Promise<void>[] = [];
      page.on('response', (response) => {
        if (captured.length >= 30) return;
        const contentType = response.headers()['content-type'] ?? '';
        if (!contentType.includes('json') && !response.url().endsWith('.json')) return;
        if (response.status() < 200 || response.status() >= 300) return;
        const entry: CapturedNetworkResponse = {
          url: response.url(),
          status: response.status(),
          contentType,
          body: '',
        };
        captured.push(entry);
        bodyReads.push(response.text()
          .then((text) => { if (text.length <= 512_000) entry.body = text; })
          .catch(() => undefined));
      });
      const render = action.render;
      const timeout = render?.timeoutMs ?? 30000;
      await page.goto(url, { waitUntil: render?.waitUntil ?? 'domcontentloaded', timeout });
      if (render?.waitUntil === 'networkidle') {
        await page.waitForLoadState('networkidle', { timeout: Math.min(timeout, 5000) }).catch(() => undefined);
      }
      if (render?.waitForSelector) {
        await page.waitForSelector(render.waitForSelector, { timeout: Math.min(timeout, 15000) }).catch(() => undefined);
      }
      if (action.kind === 'click' && action.selector) {
        await page.click(action.selector, { timeout: 10000 });
        await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => undefined);
      } else if (action.kind === 'scroll') {
        // scroll: disparar lazy-load / infinite-scroll inicial (§59)
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => undefined);
      } else {
        // render: esperar a que el framework hidrate el DOM sin interactuar.
        await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => undefined);
      }
      const minWait = action.kind === 'scroll'
        ? Math.max(render?.waitMs ?? 0, 1200)
        : action.kind === 'click'
          ? Math.max(render?.waitMs ?? 0, 800)
          : (render?.waitMs ?? 500);
      await settlePage(page, minWait);
      await Promise.allSettled(bodyReads);
      const html = await page.content().catch(() => '');
      const title = (await page.title().catch(() => ''))?.slice(0, 200) ?? '';
      opts?.signal?.removeEventListener('abort', onAbort);
      return { html, url: page.url(), title, network: captured };
    } finally {
      if (context) await context.close().catch(() => undefined);
      release();
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
    const allowlist = createAllowlist(input.url);
    const credentialOrigin = new URL(input.url).origin;
    const credentialKeys = new Set(Object.keys(input.headers ?? {}).map((key) => key.toLowerCase()));
    const requestQueue = await freshQueue();
    const crawler = new CheerioCrawler({
      requestQueue,
      maxRequestsPerCrawl: input.maxRequests ?? 20,
      maxCrawlDepth: maxDepth,
      maxConcurrency: input.maxConcurrency ?? Number(process.env.CRAWLEE_MAX_CONCURRENCY ?? 5),
      maxRequestsPerMinute: input.maxRequestsPerMinute ?? envRequestsPerMinute(),
      maxRequestRetries: input.maxRetries ?? 3,
      requestHandlerTimeoutSecs: input.requestTimeoutSecs ?? 30,
      useSessionPool: true,
      sessionPoolOptions: { maxPoolSize: 20 },
      preNavigationHooks: [
        async ({ request }, gotOptions) => {
          await assertSafeUrl(request.url);
          allowlist.assert(request.url);
          gotOptions.dnsLookup = safeDnsLookup;
          const requestOrigin = new URL(request.url).origin;
          if (input.headers && requestOrigin === credentialOrigin) {
            gotOptions.headers = { ...(gotOptions.headers ?? {}), ...input.headers };
          }
          const beforeRedirect = gotOptions.hooks?.beforeRedirect ?? [];
          gotOptions.hooks = {
            ...(gotOptions.hooks ?? {}),
            beforeRedirect: [
              ...beforeRedirect,
              async (updatedOptions: {
                url: URL;
                dnsLookup?: typeof safeDnsLookup;
                headers: Record<string, string | string[] | undefined>;
              }) => {
                const redirectUrl = updatedOptions.url.toString();
                await assertSafeUrl(redirectUrl);
                allowlist.assert(redirectUrl);
                updatedOptions.dnsLookup = safeDnsLookup;
                if (updatedOptions.url.origin !== credentialOrigin) {
                  for (const key of Object.keys(updatedOptions.headers)) {
                    if (credentialKeys.has(key.toLowerCase())) delete updatedOptions.headers[key];
                  }
                }
              },
            ],
          };
        },
      ],
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
            strategy: 'same-domain',
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
    const allowedDomain = new URL(input.url).hostname;
    const credentialOrigin = new URL(input.url).origin;
    const requestQueue = await freshQueue();
    const crawler = new PlaywrightCrawler({
      requestQueue,
      headless: process.env.CRAWLEE_HEADLESS !== 'false',
      maxRequestsPerCrawl: input.maxRequests ?? 20,
      maxCrawlDepth: maxDepth,
      maxConcurrency: Math.min(input.maxConcurrency ?? 3, 5),
      maxRequestsPerMinute: input.maxRequestsPerMinute ?? envRequestsPerMinute(),
      maxRequestRetries: input.maxRetries ?? 2,
      navigationTimeoutSecs: input.requestTimeoutSecs ?? 30,
      requestHandlerTimeoutSecs: (input.requestTimeoutSecs ?? 30) + 30,
      preNavigationHooks: [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async ({ page }: any) => {
          await installNavigationGuard(page, { allowedDomain, credentialOrigin, headers: input.headers });
        },
      ],
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
            strategy: 'same-domain',
          });
        }
      },
    });
    await crawler.run([input.url]);
    return pages;
  }
}
