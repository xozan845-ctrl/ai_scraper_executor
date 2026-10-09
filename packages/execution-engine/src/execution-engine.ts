/**
 * Execution Engine §27 — FASE 2 real (HTTP/Cheerio) + escalado browser (ETAPA 3, §34).
 * Traduce el DSL tipado a operaciones DOM. Sin eval() libre (§4).
 *
 * - NAVIGATE / INSPECT_* / EXTRACT / EXTRACT_LIST / FOLLOW_LINKS / PAGINATE funcionales en HTTP.
 * - CLICK no-enlace y SCROLL: si hay `browserInteract` (CrawlerService.interact),
 *   se ejecutan en Chromium real y el HTML resultante se carga en Cheerio;
 *   sin delegado se devuelve { needsBrowser: true } como antes.
 * - Trazabilidad §33: cada item incluye _source { url, selector, scrapedAt }.
 */
import * as cheerio from 'cheerio';
import { createHash } from 'node:crypto';
import type { ScrapingCommand as StrictCommand } from '@ai-scraper/domain-ai';
import { logger } from '@ai-scraper/shared-observability';
import { assertPublicUrl, isAllowedHost, safeFetchText } from '@ai-scraper/shared-security';
import { PageCache, normalizeUrlForDedupe } from './page-cache';

/**
 * Fuente única del DSL: @ai-scraper/domain-ai (Zod).
 * El engine acepta el tipo estricto + comandos desconocidos en runtime
 * (la IA puede alucinar tipos) para devolver error recuperable, no crash.
 */
export interface LooseCommand {
  type: string;
  url?: string;
  selector?: string;
  attribute?: string;
  fields?: Record<string, string | { selector: string; attribute?: string }>;
  limit?: number;
  maxLinks?: number;
  maxPages?: number;
  pattern?: string;
  sameDomainOnly?: boolean;
  ms?: number;
  reason?: string;
  [key: string]: unknown;
}
export type ScrapingCommand = StrictCommand | LooseCommand;
export type { StrictCommand };

export interface ExecutionResult {
  ok: boolean;
  commandType: string;
  items?: unknown[];
  count?: number;
  data?: unknown;
  error?: string;
  nextHint?: string;
  needsBrowser?: boolean;
  /** true cuando la acción se resolvió en Chromium real (ETAPA 3). */
  usedBrowser?: boolean;
}

/** Acción browser delegada al CrawlerService (ETAPA 3, §34). */
export interface BrowserAction {
  kind: 'click' | 'scroll';
  selector?: string;
}

export interface BrowserResult {
  html: string;
  url: string;
  title?: string;
}

export type BrowserInteract = (url: string, action: BrowserAction, signal?: AbortSignal) => Promise<BrowserResult>;

export interface EngineMemory {
  visited: string[];
  lastUrl: string | null;
  lastItems: number;
  discoveredSelectors: string[];
}

type Fetcher = (url: string, signal?: AbortSignal) => Promise<string>;

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/** Seguridad §37 centralizada en @ai-scraper/shared-security (ETAPA 2). */

async function defaultFetchHtml(
  url: string,
  opts?: { headers?: Record<string, string>; credentialOrigin?: string; allowedDomain?: string; signal?: AbortSignal },
): Promise<string> {
  // SSRF: valida host + DNS en cada hop y sigo redirects a mano (sin auto-follow).
  const { html } = await safeFetchText(url, {
    headers: opts?.headers,
    publicHeaders: { 'User-Agent': 'AI-Scraping-Executor/0.2 (+agnostic crawler)' },
    credentialOrigin: opts?.credentialOrigin,
    allowedDomain: opts?.allowedDomain,
    timeoutMs: 20000,
    maxBytes: 2_000_000,
    maxRedirects: 5,
    signal: opts?.signal,
  });
  return html;
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

/**
 * Caché de páginas aceptada por el engine: sync (memoria) o async (Redis).
 * La clave la deriva el engine (ver `ExecutionEngine.cacheKey`): incluye el
 * scope de credenciales, de modo que el HTML autenticado de un contexto nunca
 * se sirve a otro (fuga cross-session). Implementaciones de memoria/Redis tratan
 * la clave como opaca y la normalizan cuando es una URL válida.
 */
export interface EnginePageCache {
  get(key: string): string | null | Promise<string | null>;
  set(key: string, html: string): void | Promise<void>;
  hits?: number;
  misses?: number;
  size?: number;
}

/**
 * Scope estable y no reversible de un juego de headers (credenciales).
 * Ordena las claves y hashea para que el mismo contexto comparta caché y
 * contextos distintos jamás colisionen. Nunca incluye el valor en claro.
 */
function credentialScope(headers: Record<string, string>): string {
  const canonical = Object.entries(headers)
    .map(([k, v]) => [k.toLowerCase(), v] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}:${v ?? ''}`)
    .join('\n');
  return `cred-${createHash('sha256').update(canonical).digest('hex').slice(0, 16)}`;
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
      /** Delegado browser (CrawlerService.interact). Sin él, CLICK/SCROLL devuelven needsBrowser. */
      browserInteract?: BrowserInteract;
      /** Caché HTML compartible (FASE 11/Redis). Por defecto, caché propia por engine. */
      pageCache?: EnginePageCache;
      /** Headers extra (credenciales de sesión: Authorization/Cookie). */
      headers?: Record<string, string>;
      /** Dominio inmutable del job. Si se omite, se fija con el primer NAVIGATE. */
      allowedDomain?: string;
      /** Origin exacto autorizado para las cabeceras de sesión. */
      credentialOrigin?: string;
      /** Deadline/cancelación del job, propagado a HTTP, browser y fetchers. */
      signal?: AbortSignal;
    },
  ) {
    this.pageCache = deps?.pageCache ?? new PageCache();
    const headers = deps?.headers;
    this.cacheScope = headers && Object.keys(headers).length > 0 ? credentialScope(headers) : undefined;
    this.allowedDomain = deps?.allowedDomain?.toLowerCase();
    this.credentialOrigin = deps?.credentialOrigin ? assertPublicUrl(deps.credentialOrigin).origin : undefined;
  }

  private readonly pageCache: EnginePageCache;
  /** Scope de credenciales para aislar la caché compartida (undefined = anónimo). */
  private readonly cacheScope: string | undefined;
  private allowedDomain: string | undefined;
  private credentialOrigin: string | undefined;

  private assertUrlAllowed(url: string): URL {
    const parsed = assertPublicUrl(url);
    if (!this.allowedDomain) this.allowedDomain = parsed.hostname.toLowerCase();
    if (!isAllowedHost(parsed.hostname, this.allowedDomain)) {
      throw new Error(`URL fuera del dominio permitido (${this.allowedDomain}): ${url}`);
    }
    if (!this.credentialOrigin) this.credentialOrigin = parsed.origin;
    return parsed;
  }

  /** Clave de caché aislada por credenciales: el HTML autenticado no se filtra entre contextos. */
  private cacheKey(url: string): string {
    if (!this.cacheScope) return url;
    return `${this.cacheScope}|${normalizeUrlForDedupe(url)}`;
  }

  /** Stats de caché para observabilidad (solo si la caché las expone). */
  getCacheStats(): { hits: number; misses: number; size: number } {
    return { hits: this.pageCache.hits ?? 0, misses: this.pageCache.misses ?? 0, size: this.pageCache.size ?? 0 };
  }

  getMemory(): EngineMemory {
    return { ...this.memory, visited: [...this.memory.visited] };
  }

  getCurrentUrl(): string | null {
    return this.currentUrl;
  }

  private async fetchHtml(url: string): Promise<string> {
    if (this.deps?.signal?.aborted) throw this.deps.signal.reason;
    this.assertUrlAllowed(url);
    // Caché (memoria o Redis) aislada por scope de credenciales. Si falla
    // (Redis caído), se ignora sin romper el scraping.
    const key = this.cacheKey(url);
    try {
      const cached = await this.pageCache.get(key);
      if (cached !== null && cached !== undefined) return cached;
    } catch { /* cache miss/error → fetch */ }
    let html: string;
    if (this.deps?.fetcher) {
      html = await abortable(this.deps.fetcher(url, this.deps.signal), this.deps.signal);
    } else if (this.deps?.crawlPage) {
      // Compat FASE 0: solo metadata, sin DOM → marcar y seguir con fetch real.
      await abortable(this.deps.crawlPage(url), this.deps.signal);
      html = await defaultFetchHtml(url, {
        headers: this.deps?.headers,
        credentialOrigin: this.credentialOrigin,
        allowedDomain: this.allowedDomain,
        signal: this.deps?.signal,
      });
    } else {
      html = await defaultFetchHtml(url, {
        headers: this.deps?.headers,
        credentialOrigin: this.credentialOrigin,
        allowedDomain: this.allowedDomain,
        signal: this.deps?.signal,
      });
    }
    try {
      await this.pageCache.set(key, html);
    } catch { /* noop */ }
    return html;
  }

  private async loadUrl(url: string): Promise<void> {
    this.assertUrlAllowed(url);
    const html = await this.fetchHtml(url);
    this.$ = cheerio.load(html);
    this.currentUrl = url;
    this.currentHtmlLength = html.length;
    if (!this.memory.visited.includes(url)) this.memory.visited.push(url);
    this.memory.lastUrl = url;
  }

  /** Carga HTML ya obtenido (p.ej. tras interacción browser) sin refetch. */
  private loadHtml(url: string, html: string): void {
    this.assertUrlAllowed(url);
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
    // Vista suelta para runtime: StrictCommand es asignable a LooseCommand,
    // así el switch no colapsa a `never` y acepta comandos alucinados por la IA.
    const cmd: LooseCommand = command as LooseCommand;
    try {
      switch (cmd.type) {
        case 'NAVIGATE': {
          if (!cmd.url) return { ok: false, commandType: 'NAVIGATE', error: 'NAVIGATE requiere url' };
          await this.loadUrl(cmd.url);
          const title = this.$!('title').first().text().trim().slice(0, 200);
          logger.debug('navigate', { url: cmd.url, title, htmlLength: this.currentHtmlLength });
          return { ok: true, commandType: 'NAVIGATE', count: this.currentHtmlLength, nextHint: title || cmd.url };
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
          if (!cmd.fields) return { ok: false, commandType: 'EXTRACT', error: 'EXTRACT requiere fields' };
          const obj: Record<string, unknown> = {};
          for (const [k, spec] of Object.entries(cmd.fields)) {
            obj[k] = {
              value: extractFieldValue($, $, spec),
              source: {
                url: this.currentUrl,
                selector: typeof spec === 'string' ? spec : spec.selector,
                scrapedAt: new Date().toISOString(),
              },
            };
          }
          obj._source = {
            url: this.currentUrl,
            selector: [...new Set(Object.values(cmd.fields).map((spec) => typeof spec === 'string' ? spec : spec.selector))].join(', ').slice(0, 500),
            scrapedAt: new Date().toISOString(),
          };
          this.memory.lastItems = 1;
          logger.debug('extract', { fields: Object.keys(cmd.fields), url: this.currentUrl });
          return { ok: true, commandType: 'EXTRACT', items: [obj], count: 1 };
        }

        case 'EXTRACT_LIST': {
          const $ = this.requirePage();
          if (!cmd.selector) return { ok: false, commandType: 'EXTRACT_LIST', error: 'selector requerido' };
          if (!cmd.fields) return { ok: false, commandType: 'EXTRACT_LIST', error: 'fields requerido' };
          const limit = Math.min(cmd.limit ?? 100, 1000);
          const items: Record<string, unknown>[] = [];
          const cards = $(cmd.selector);
          logger.debug('extract_list.start', { selector: cmd.selector, limit, cardsFound: cards.length, fields: Object.keys(cmd.fields), url: this.currentUrl });
          if (cards.length === 0) {
            return {
              ok: false,
              commandType: 'EXTRACT_LIST',
              error: `0 elementos para selector "${cmd.selector}" → Recovery (§28): probar INSPECT_ELEMENTS`,
            };
          }
          cards.each((_, card) => {
            if (items.length >= limit) return false;
            const row: Record<string, unknown> = {};
            for (const [k, spec] of Object.entries(cmd.fields!)) {
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
                source: { url: this.currentUrl, selector: `${cmd.selector} ${sel}`, scrapedAt: new Date().toISOString() },
              };
            }
            row._source = { url: this.currentUrl, selector: cmd.selector, scrapedAt: new Date().toISOString() };
            items.push(row);
          });
          this.memory.lastItems = items.length;
          logger.debug('extract_list.done', { extracted: items.length, url: this.currentUrl });
          return { ok: true, commandType: 'EXTRACT_LIST', items, count: items.length };
        }

        case 'GET_ATTRIBUTE': {
          const $ = this.requirePage();
          if (!cmd.selector || !cmd.attribute) {
            return { ok: false, commandType: 'GET_ATTRIBUTE', error: 'selector y attribute requeridos' };
          }
          const vals: Array<{ value: string | null; attribute: string; _source: { url: string | null; selector: string; scrapedAt: string } }> = [];
          $(cmd.selector).each((_, el) => {
            if (vals.length >= 100) return false;
            vals.push({
              value: $(el).attr(cmd.attribute!) ?? null,
              attribute: cmd.attribute!,
              _source: { url: this.currentUrl, selector: cmd.selector!, scrapedAt: new Date().toISOString() },
            });
          });
          return { ok: true, commandType: 'GET_ATTRIBUTE', items: vals, count: vals.length };
        }

        case 'CLICK': {
          const $ = this.requirePage();
          if (!cmd.selector) return { ok: false, commandType: 'CLICK', error: 'selector requerido' };
          const el = $(cmd.selector).first();
          if (el.length === 0) {
            return { ok: false, commandType: 'CLICK', error: `selector no encontrado: ${cmd.selector}` };
          }
          // Solo soportamos click en enlace en modo HTTP.
          const href = el.closest('a').attr('href') ?? (el.is('a') ? el.attr('href') : undefined);
          if (href) {
            const abs = toAbs(href, this.currentUrl!);
            if (!abs) return { ok: false, commandType: 'CLICK', error: `href no resoluble: ${href}` };
            await this.loadUrl(abs);
            return { ok: true, commandType: 'CLICK', nextHint: abs };
          }
          // ETAPA 3: escalar a Chromium real cuando hay delegado.
          if (this.deps?.browserInteract && cmd.selector) {
            try {
              const out = await this.deps.browserInteract(this.currentUrl!, { kind: 'click', selector: cmd.selector }, this.deps.signal);
              this.loadHtml(out.url, out.html);
              return { ok: true, commandType: 'CLICK', usedBrowser: true, nextHint: out.title || out.url };
            } catch (e) {
              if (this.deps?.signal?.aborted) throw this.deps.signal.reason;
              return { ok: false, commandType: 'CLICK', needsBrowser: true, error: `browser CLICK falló: ${(e as Error).message}` };
            }
          }
          return {
            ok: false,
            commandType: 'CLICK',
            needsBrowser: true,
            error: 'CLICK no-enlace requiere Playwright (botones/JS). Escalar a browser (§34).',
          };
        }

        case 'WAIT': {
          const ms = Math.min(Number(cmd.ms ?? 1000), 5000);
          await new Promise<void>((resolve, reject) => {
            const onAbort = () => {
              clearTimeout(timer);
              reject(this.deps?.signal?.reason);
            };
            const timer = setTimeout(() => {
              this.deps?.signal?.removeEventListener('abort', onAbort);
              resolve();
            }, ms);
            if (this.deps?.signal?.aborted) onAbort();
            else this.deps?.signal?.addEventListener('abort', onAbort, { once: true });
          });
          logger.debug('wait', { ms });
          return { ok: true, commandType: 'WAIT', nextHint: `esperados ${ms}ms` };
        }

        case 'SCROLL': {
          this.requirePage();
          // ETAPA 3: scroll real en Chromium (lazy-load / infinite-scroll).
          if (this.deps?.browserInteract && this.currentUrl) {
            try {
              const out = await this.deps.browserInteract(this.currentUrl, { kind: 'scroll', selector: cmd.selector }, this.deps.signal);
              this.loadHtml(out.url, out.html);
              return { ok: true, commandType: 'SCROLL', usedBrowser: true, nextHint: `scroll browser (${out.html.length}b)` };
            } catch (e) {
              if (this.deps?.signal?.aborted) throw this.deps.signal.reason;
              return { ok: false, commandType: 'SCROLL', needsBrowser: true, error: `browser SCROLL falló: ${(e as Error).message}` };
            }
          }
          return {
            ok: true,
            commandType: 'SCROLL',
            needsBrowser: true,
            nextHint: 'SCROLL en HTTP es no-op; para infinite-scroll usar browser o PAGINATE (§59).',
          };
        }

        case 'FOLLOW_LINKS': {
          const $ = this.requirePage();
          if (!cmd.selector) return { ok: false, commandType: 'FOLLOW_LINKS', error: 'selector requerido' };
          const maxLinks = Math.min(cmd.maxLinks ?? 10, 100);
          const baseHost = new URL(this.currentUrl!).hostname;
          const hrefs: string[] = [];
          const seen = new Set<string>();
          $(cmd.selector).each((_, el) => {
            if (hrefs.length >= maxLinks) return false;
            const raw = $(el).attr('href') ?? $(el).find('a').first().attr('href') ?? '';
            const abs = toAbs(raw, this.currentUrl!);
            if (!abs) return;
            if (cmd.sameDomainOnly !== false && new URL(abs).hostname !== baseHost) return;
            // FASE 11: deduplicar variantes (/p, /p/, /p#frag → una sola).
            const key = normalizeUrlForDedupe(abs);
            if (seen.has(key)) return;
            seen.add(key);
            hrefs.push(abs);
          });
          const visited: Array<{
            url: string;
            title: string;
            htmlLength: number;
            _source: { url: string; selector: string; scrapedAt: string };
          }> = [];
          // ETAPA 3+6: no refetchear URLs ya visitadas; la caché evita refetch entre comandos.
          const seenVisited = new Set(this.memory.visited.map((v) => normalizeUrlForDedupe(v)));
          const pending = hrefs.filter((h) => !seenVisited.has(normalizeUrlForDedupe(h)));
          for (const href of pending) {
            try {
              const html = await this.fetchHtml(href);
              const $$ = cheerio.load(html);
              visited.push({
                url: href,
                title: $$('title').first().text().trim().slice(0, 200),
                htmlLength: html.length,
                _source: { url: href, selector: cmd.selector, scrapedAt: new Date().toISOString() },
              });
              if (!this.memory.visited.includes(href)) this.memory.visited.push(href);
            } catch (e) {
              if (this.deps?.signal?.aborted) throw this.deps.signal.reason;
              visited.push({
                url: href,
                title: `ERROR: ${(e as Error).message}`,
                htmlLength: 0,
                _source: { url: href, selector: cmd.selector, scrapedAt: new Date().toISOString() },
              });
            }
          }
          return { ok: true, commandType: 'FOLLOW_LINKS', items: visited, count: visited.length };
        }

        case 'PAGINATE': {
          if (cmd.pattern) {
            const maxPages = Math.min(cmd.maxPages ?? 5, 50);
            const urls: string[] = [];
            for (let p = 1; p <= maxPages; p++) {
              const u = cmd.pattern.replace('{page}', String(p)).replace('N', String(p));
              const abs = toAbs(u, this.currentUrl ?? cmd.url ?? '') ?? u;
              urls.push(abs);
            }
            return { ok: true, commandType: 'PAGINATE', items: urls, count: urls.length };
          }
          if (cmd.selector) {
            const $ = this.requirePage();
            const next = $(cmd.selector).first();
            const href = next.attr('href') ?? next.find('a').first().attr('href');
            if (!href) {
              return {
                ok: false,
                commandType: 'PAGINATE',
                error: `No se encontró enlace siguiente con "${cmd.selector}"`,
              };
            }
            return { ok: true, commandType: 'PAGINATE', items: [toAbs(href, this.currentUrl!)], count: 1 };
          }
          return { ok: false, commandType: 'PAGINATE', error: 'PAGINATE requiere pattern o selector' };
        }

        case 'TYPE': {
          const $ = this.requirePage();
          if (!cmd.selector) return { ok: false, commandType: 'TYPE', error: 'selector requerido' };
          const text = (cmd as { text?: string }).text;
          if (!text) return { ok: false, commandType: 'TYPE', error: 'text requerido' };
          const el = $(cmd.selector).first();
          if (el.length === 0) {
            return { ok: false, commandType: 'TYPE', error: `selector no encontrado: ${cmd.selector}` };
          }
          // Establecer valor en input/textarea (Cheerio .val() es suficiente para el engine).
          if (el.is('input') || el.is('textarea')) {
            el.val(text);
          } else {
            // Para lectura/debug: almacenar texto en un elemento visible o ignorado.
            el.text(text);
          }
          return { ok: true, commandType: 'TYPE', nextHint: `valor establecido en ${cmd.selector}` };
        }

        case 'AUTHENTICATE': {
          this.requirePage();
          if (!cmd.usernameSelector || !cmd.passwordSelector) {
            return { ok: false, commandType: 'AUTHENTICATE', error: 'usernameSelector y passwordSelector requeridos' };
          }
          // TYPE AUTHENTICATE: en HTTP solo registramos la intención.
          // El motor completará el login cuando ejecute el job con browserInteract (ETAPA 3).
          return { ok: true, commandType: 'AUTHENTICATE', nextHint: 'credentials intentadas, awaiting next page' };
        }

        case 'FINISH':
          return { ok: true, commandType: 'FINISH', nextHint: 'objetivo cumplido' };

        default:
          return { ok: false, commandType: cmd.type, error: `Comando no soportado: ${cmd.type}` };
      }
    } catch (e) {
      if (this.deps?.signal?.aborted) throw this.deps.signal.reason;
      return { ok: false, commandType: cmd.type, error: (e as Error).message };
    }
  }
}
