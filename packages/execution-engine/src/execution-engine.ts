/**
 * Execution Engine §27 — FASE 2 real (HTTP/Cheerio).
 * Traduce el DSL tipado a operaciones DOM. Sin eval() libre (§4).
 *
 * - NAVIGATE / INSPECT_* / EXTRACT / EXTRACT_LIST / FOLLOW_LINKS / PAGINATE funcionales en HTTP.
 * - CLICK no-enlace, SCROLL con JS pesado y formularios → { needsBrowser: true } para que
 *   el Agent Loop escale a Playwright (§34) en FASE 5 en vez de fallar en silencio.
 * - Trazabilidad §33: cada item incluye _source { url, selector, scrapedAt }.
 */
import * as cheerio from 'cheerio';

export interface ScrapingCommand {
  type: string;
  url?: string;
  selector?: string;
  selectors?: string[];
  fields?: Record<string, string | { selector: string; attribute?: string }>;
  attribute?: string;
  limit?: number;
  maxLinks?: number;
  maxPages?: number;
  pattern?: string;
  sameDomainOnly?: boolean;
  ms?: number;
  reason?: string;
  [key: string]: unknown;
}

export interface ExecutionResult {
  ok: boolean;
  commandType: string;
  items?: unknown[];
  count?: number;
  data?: unknown;
  error?: string;
  nextHint?: string;
  needsBrowser?: boolean;
}

export interface EngineMemory {
  visited: string[];
  lastUrl: string | null;
  lastItems: number;
  discoveredSelectors: string[];
}

type Fetcher = (url: string) => Promise<string>;

const BLOCKED = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '169.254.169.254']);

function assertPublicUrl(raw: string): URL {
  const u = new URL(raw);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error(`Protocolo no permitido: ${u.protocol}`);
  if (process.env.ALLOW_PRIVATE_HOSTS === '1') return u;
  const h = u.hostname;
  if (BLOCKED.has(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) {
    throw new Error(`SSRF bloqueado (§37): ${h}`);
  }
  return u;
}

async function defaultFetchHtml(url: string): Promise<string> {
  assertPublicUrl(url);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'AI-Scraping-Executor/0.2 (+agnostic crawler)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
    const text = await res.text();
    if (text.length > 2_000_000) throw new Error('HTML demasiado grande (>2MB), usar contexto reducido');
    return text;
  } finally {
    clearTimeout(t);
  }
}

function toAbs(href: string, base: string): string | null {
  if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function extractFieldValue(
  $: cheerio.CheerioAPI,
  scope: cheerio.Cheerio<unknown> | cheerio.CheerioAPI,
  spec: string | { selector: string; attribute?: string },
): string | null {
  const sel = typeof spec === 'string' ? spec : spec.selector;
  const attr = typeof spec === 'string' ? undefined : spec.attribute;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const el = (scope as any)(sel).first?.() ?? $(sel).first();
  if (!el || el.length === 0) return null;
  if (!attr || attr === 'text') return el.text().replace(/\s+/g, ' ').trim().slice(0, 500) || null;
  if (attr === 'html') return el.html()?.slice(0, 1000) ?? null;
  return el.attr(attr)?.slice(0, 1000) ?? null;
}

export class ExecutionEngine {
  private $: cheerio.CheerioAPI | null = null;
  private currentUrl: string | null = null;
  private currentHtmlLength = 0;
  private memory: EngineMemory = { visited: [], lastUrl: null, lastItems: 0, discoveredSelectors: [] };

  constructor(
    private readonly deps?: {
      crawlPage?: (url: string) => Promise<{ title: string; links: unknown[]; htmlLength: number }>;
      fetcher?: Fetcher;
    },
  ) {}

  getMemory(): EngineMemory {
    return { ...this.memory, visited: [...this.memory.visited] };
  }

  getCurrentUrl(): string | null {
    return this.currentUrl;
  }

  private async loadUrl(url: string): Promise<void> {
    assertPublicUrl(url);
    let html: string;
    if (this.deps?.fetcher) {
      html = await this.deps.fetcher(url);
    } else if (this.deps?.crawlPage) {
      // Compat FASE 0: solo metadata, sin DOM → marcar y seguir con fetch real.
      await this.deps.crawlPage(url);
      html = await defaultFetchHtml(url);
    } else {
      html = await defaultFetchHtml(url);
    }
    this.$ = cheerio.load(html);
    this.currentUrl = url;
    this.currentHtmlLength = html.length;
    if (!this.memory.visited.includes(url)) this.memory.visited.push(url);
    this.memory.lastUrl = url;
  }

  private requirePage(): cheerio.CheerioAPI {
    if (!this.$ || !this.currentUrl) throw new Error('Sin página cargada: emite NAVIGATE primero');
    return this.$;
  }

  async execute(command: ScrapingCommand): Promise<ExecutionResult> {
    try {
      switch (command.type) {
        case 'NAVIGATE': {
          if (!command.url) return { ok: false, commandType: 'NAVIGATE', error: 'NAVIGATE requiere url' };
          await this.loadUrl(command.url);
          const title = this.$!('title').first().text().trim().slice(0, 200);
          return { ok: true, commandType: 'NAVIGATE', count: this.currentHtmlLength, nextHint: title || command.url };
        }

        case 'INSPECT_PAGE': {
          const $ = this.requirePage();
          const title = $('title').first().text().trim().slice(0, 200);
          const links = $('a[href]').length;
          return {
            ok: true,
            commandType: 'INSPECT_PAGE',
            data: {
              url: this.currentUrl,
              title,
              htmlLength: this.currentHtmlLength,
              linksCount: links,
              textSnippet: $('body').text().replace(/\s+/g, ' ').trim().slice(0, 500),
            },
          };
        }

        case 'INSPECT_LINKS': {
          const $ = this.requirePage();
          const links: Array<{ text: string; href: string }> = [];
          $('a[href]').each((_, el) => {
            if (links.length >= 80) return false;
            const raw = $(el).attr('href') ?? '';
            const abs = toAbs(raw, this.currentUrl!);
            if (!abs) return;
            links.push({
              text: $(el).text().replace(/\s+/g, ' ').trim().slice(0, 120),
              href: abs,
            });
          });
          return { ok: true, commandType: 'INSPECT_LINKS', items: links, count: links.length };
        }

        case 'INSPECT_ELEMENTS': {
          const $ = this.requirePage();
          const out: Array<{ type: string; selector: string; text: string }> = [];
          for (const sel of ['.product-card', '.product', '[data-product]', '.card', 'article', '.item', 'li']) {
            const found = $(sel);
            if (found.length === 0 || found.length > 200) continue;
            found.each((_, el) => {
              if (out.length >= 40) return false;
              const text = $(el).text().replace(/\s+/g, ' ').trim().slice(0, 120);
              if (text.length < 3) return;
              out.push({
                type: /[$€£]\s?\d|precio|price/i.test(text) ? 'product' : 'element',
                selector: sel,
                text,
              });
            });
            if (out.length >= 20) break;
          }
          if (out.length > 0 && !this.memory.discoveredSelectors.includes(out[0]!.selector)) {
            this.memory.discoveredSelectors.push(out[0]!.selector);
          }
          return { ok: true, commandType: 'INSPECT_ELEMENTS', items: out, count: out.length };
        }

        case 'EXTRACT': {
          const $ = this.requirePage();
          if (!command.fields) return { ok: false, commandType: 'EXTRACT', error: 'EXTRACT requiere fields' };
          const obj: Record<string, unknown> = {};
          for (const [k, spec] of Object.entries(command.fields)) {
            obj[k] = {
              value: extractFieldValue($, $, spec),
              source: {
                url: this.currentUrl,
                selector: typeof spec === 'string' ? spec : spec.selector,
                scrapedAt: new Date().toISOString(),
              },
            };
          }
          this.memory.lastItems = 1;
          return { ok: true, commandType: 'EXTRACT', items: [obj], count: 1 };
        }

        case 'EXTRACT_LIST': {
          const $ = this.requirePage();
          if (!command.selector) return { ok: false, commandType: 'EXTRACT_LIST', error: 'selector requerido' };
          if (!command.fields) return { ok: false, commandType: 'EXTRACT_LIST', error: 'fields requerido' };
          const limit = Math.min(command.limit ?? 100, 1000);
          const items: Record<string, unknown>[] = [];
          const cards = $(command.selector);
          if (cards.length === 0) {
            return {
              ok: false,
              commandType: 'EXTRACT_LIST',
              error: `0 elementos para selector "${command.selector}" → Recovery (§28): probar INSPECT_ELEMENTS`,
            };
          }
          cards.each((_, card) => {
            if (items.length >= limit) return false;
            const row: Record<string, unknown> = {};
            for (const [k, spec] of Object.entries(command.fields!)) {
              const sel = typeof spec === 'string' ? spec : spec.selector;
              const attr = typeof spec === 'string' ? undefined : spec.attribute;
              const el = $(card).find(sel).first();
              const value =
                el.length === 0
                  ? null
                  : !attr || attr === 'text'
                    ? el.text().replace(/\s+/g, ' ').trim().slice(0, 500) || null
                    : el.attr(attr)?.slice(0, 1000) ?? null;
              row[k] = {
                value,
                source: { url: this.currentUrl, selector: `${command.selector} ${sel}`, scrapedAt: new Date().toISOString() },
              };
            }
            row._source = { url: this.currentUrl, selector: command.selector, scrapedAt: new Date().toISOString() };
            items.push(row);
          });
          this.memory.lastItems = items.length;
          return { ok: true, commandType: 'EXTRACT_LIST', items, count: items.length };
        }

        case 'GET_ATTRIBUTE': {
          const $ = this.requirePage();
          if (!command.selector || !command.attribute) {
            return { ok: false, commandType: 'GET_ATTRIBUTE', error: 'selector y attribute requeridos' };
          }
          const vals: Array<string | null> = [];
          $(command.selector).each((_, el) => {
            if (vals.length >= 100) return false;
            vals.push($(el).attr(command.attribute!) ?? null);
          });
          return { ok: true, commandType: 'GET_ATTRIBUTE', items: vals, count: vals.length };
        }

        case 'CLICK': {
          const $ = this.requirePage();
          if (!command.selector) return { ok: false, commandType: 'CLICK', error: 'selector requerido' };
          const el = $(command.selector).first();
          if (el.length === 0) {
            return { ok: false, commandType: 'CLICK', error: `selector no encontrado: ${command.selector}` };
          }
          // Solo soportamos click en enlace en modo HTTP.
          const href = el.closest('a').attr('href') ?? (el.is('a') ? el.attr('href') : undefined);
          if (href) {
            const abs = toAbs(href, this.currentUrl!);
            if (!abs) return { ok: false, commandType: 'CLICK', error: `href no resoluble: ${href}` };
            await this.loadUrl(abs);
            return { ok: true, commandType: 'CLICK', nextHint: abs };
          }
          return {
            ok: false,
            commandType: 'CLICK',
            needsBrowser: true,
            error: 'CLICK no-enlace requiere Playwright (botones/JS). Escalar a browser (§34).',
          };
        }

        case 'WAIT': {
          const ms = Math.min(Number(command.ms ?? 1000), 5000);
          await new Promise((r) => setTimeout(r, ms));
          return { ok: true, commandType: 'WAIT', nextHint: `esperados ${ms}ms` };
        }

        case 'SCROLL': {
          return {
            ok: true,
            commandType: 'SCROLL',
            needsBrowser: true,
            nextHint: 'SCROLL en HTTP es no-op; para infinite-scroll usar browser o PAGINATE (§59).',
          };
        }

        case 'FOLLOW_LINKS': {
          const $ = this.requirePage();
          if (!command.selector) return { ok: false, commandType: 'FOLLOW_LINKS', error: 'selector requerido' };
          const maxLinks = Math.min(command.maxLinks ?? 10, 100);
          const baseHost = new URL(this.currentUrl!).hostname;
          const hrefs: string[] = [];
          $(command.selector).each((_, el) => {
            if (hrefs.length >= maxLinks) return false;
            const raw = $(el).attr('href') ?? $(el).find('a').first().attr('href') ?? '';
            const abs = toAbs(raw, this.currentUrl!);
            if (!abs) return;
            if (command.sameDomainOnly !== false && new URL(abs).hostname !== baseHost) return;
            if (!hrefs.includes(abs)) hrefs.push(abs);
          });
          const visited: Array<{ url: string; title: string; htmlLength: number }> = [];
          for (const href of hrefs) {
            try {
              const html = this.deps?.fetcher ? await this.deps.fetcher(href) : await defaultFetchHtml(href);
              const $$ = cheerio.load(html);
              visited.push({
                url: href,
                title: $$('title').first().text().trim().slice(0, 200),
                htmlLength: html.length,
              });
              if (!this.memory.visited.includes(href)) this.memory.visited.push(href);
            } catch (e) {
              visited.push({ url: href, title: `ERROR: ${(e as Error).message}`, htmlLength: 0 });
            }
          }
          return { ok: true, commandType: 'FOLLOW_LINKS', items: visited, count: visited.length };
        }

        case 'PAGINATE': {
          if (command.pattern) {
            const maxPages = Math.min(command.maxPages ?? 5, 50);
            const urls: string[] = [];
            for (let p = 1; p <= maxPages; p++) {
              const u = command.pattern.replace('{page}', String(p)).replace('N', String(p));
              const abs = toAbs(u, this.currentUrl ?? command.url ?? '') ?? u;
              urls.push(abs);
            }
            return { ok: true, commandType: 'PAGINATE', items: urls, count: urls.length };
          }
          if (command.selector) {
            const $ = this.requirePage();
            const next = $(command.selector).first();
            const href = next.attr('href') ?? next.find('a').first().attr('href');
            if (!href) {
              return {
                ok: false,
                commandType: 'PAGINATE',
                error: `No se encontró enlace siguiente con "${command.selector}"`,
              };
            }
            return { ok: true, commandType: 'PAGINATE', items: [toAbs(href, this.currentUrl!)], count: 1 };
          }
          return { ok: false, commandType: 'PAGINATE', error: 'PAGINATE requiere pattern o selector' };
        }

        case 'FINISH':
          return { ok: true, commandType: 'FINISH', nextHint: 'objetivo cumplido' };

        default:
          return { ok: false, commandType: command.type, error: `Comando no soportado: ${command.type}` };
      }
    } catch (e) {
      return { ok: false, commandType: command.type, error: (e as Error).message };
    }
  }
}
