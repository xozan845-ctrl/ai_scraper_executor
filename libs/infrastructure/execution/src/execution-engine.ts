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
import type { CapturedNetworkResponse, EngineMemory, RenderOptions } from '@ai-scraper/domain-scraper';
import type { EnginePageCache } from '@ai-scraper/application-execution';
import { logger } from '@ai-scraper/shared-observability';
import { assertPublicUrl, isAllowedHost, safeFetchText } from '@ai-scraper/shared-security';
import { PageCache, normalizeUrlForDedupe } from './page-cache';
import { fetchWithRetry } from './fetch-retry';
import { needsBrowserRender } from './render-heuristic';
import { detectChallenge } from './antibot';

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
  fields?: Record<string, FieldSpec>;
  limit?: number;
  maxLength?: number;
  source?: string;
  urlContains?: string;
  path?: string;
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
  /** Código HTTP de la página cuando hubo fetch real (D, bloque 1). */
  statusCode?: number;
}

/** Acción browser delegada al CrawlerService (ETAPA 3, §34). */
export interface BrowserAction {
  kind: 'click' | 'scroll' | 'render';
  selector?: string;
  render?: RenderOptions;
}

export interface BrowserResult {
  html: string;
  url: string;
  title?: string;
  network?: CapturedNetworkResponse[];
}

export type BrowserInteract = (url: string, action: BrowserAction, signal?: AbortSignal) => Promise<BrowserResult>;

type Fetcher = (url: string, signal?: AbortSignal) => Promise<string>;

/** Concurrencia de fetch en FOLLOW_LINKS (F, bloque 2): acota sin saturar al tercero. */
const FOLLOW_LINKS_CONCURRENCY = 3;

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
): Promise<{ html: string; statusCode: number }> {
  // SSRF: valida host + DNS en cada hop y sigo redirects a mano (sin auto-follow).
  // D (bloque 1): reintento acotado solo en errores transitorios (red/5xx/429).
  const { html, status } = await fetchWithRetry(
    () =>
      safeFetchText(url, {
        headers: opts?.headers,
        publicHeaders: { 'User-Agent': 'AI-Scraping-Executor/0.2 (+agnostic crawler)' },
        credentialOrigin: opts?.credentialOrigin,
        allowedDomain: opts?.allowedDomain,
        timeoutMs: 20000,
        maxBytes: 2_000_000,
        maxRedirects: 5,
        signal: opts?.signal,
      }),
    {
      onRetry: ({ attempt, delayMs, error }) =>
        logger.warn('fetch_retry', { url, attempt, delayMs, error: (error as Error).message }),
    },
  );
  return { html, statusCode: status };
}

function toAbs(href: string, base: string): string | null {
  if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

type FieldSpec = string | string[] | { selector: string | string[]; attribute?: string };

function extractFieldValue(
  $: cheerio.CheerioAPI,
  scope: cheerio.Cheerio<unknown> | cheerio.CheerioAPI,
  spec: FieldSpec,
): { value: string | null; selector: string } {
  const selectors = typeof spec === 'string'
    ? [spec]
    : Array.isArray(spec)
      ? spec
      : (Array.isArray(spec.selector) ? spec.selector : [spec.selector]);
  const attr = typeof spec === 'string' || Array.isArray(spec) ? undefined : spec.attribute;
  const candidates: Array<{ value: string; selector: string }> = [];
  for (const selector of selectors) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scopeAny = scope as any;
    const el = typeof scopeAny.find === 'function' ? scopeAny.find(selector).first() : $(selector).first();
    if (!el || el.length === 0) continue;
    const value = !attr || attr === 'text'
      ? el.text().replace(/\s+/g, ' ').trim().slice(0, 500)
      : attr === 'html'
        ? el.html()?.slice(0, 1000) ?? ''
        : el.attr(attr)?.slice(0, 1000) ?? '';
    if (value) candidates.push({ value, selector });
  }
  if (candidates.length === 0) return { value: null, selector: selectors[0] ?? '' };
  const counts = new Map<string, number>();
  for (const candidate of candidates) counts.set(candidate.value, (counts.get(candidate.value) ?? 0) + 1);
  let winner = candidates[0]!;
  let best = 0;
  for (const candidate of candidates) {
    const score = counts.get(candidate.value) ?? 0;
    if (score > best) { best = score; winner = candidate; }
  }
  return winner;
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
  private currentHtml: string | null = null;
  private currentHtmlLength = 0;
  private lastStatusCode: number | undefined = undefined;
  /** URLs ya renderizadas en Chromium en este job (render a lo sumo una vez por URL). */
  private readonly renderedUrls = new Set<string>();
  private networkResponses: CapturedNetworkResponse[] = [];
  private memory: EngineMemory = { visited: [], lastUrl: null, lastItems: 0, discoveredSelectors: [] };
  /** Índice O(1) de URLs visitadas (evita el `includes` O(n) por navegación). */
  private readonly visitedSet = new Set<string>();
  private readonly maxVisited: number;

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
      /** Tope de URLs recordadas en memoria (FIFO). Default 1000. */
      maxVisited?: number;
      /** Selectores aprendidos del dominio; fallback si el selector de la IA da 0 (C). */
      fallbackSelectors?: () => Promise<string[]>;
      /** Configuración de render para SPAs. */
      render?: RenderOptions;
      /** Cortesía por host antes de cada fetch real (H, bloque 4). No aplica en cache hit. */
      rateLimit?: (host: string, signal?: AbortSignal) => Promise<void>;
    },
  ) {
    this.pageCache = deps?.pageCache ?? new PageCache();
    const headers = deps?.headers;
    this.cacheScope = headers && Object.keys(headers).length > 0 ? credentialScope(headers) : undefined;
    this.allowedDomain = deps?.allowedDomain?.toLowerCase();
    this.credentialOrigin = deps?.credentialOrigin ? assertPublicUrl(deps.credentialOrigin).origin : undefined;
    this.maxVisited = Math.max(1, deps?.maxVisited ?? 1000);
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

  private async fetchHtml(url: string): Promise<{ html: string; statusCode?: number }> {
    if (this.deps?.signal?.aborted) throw this.deps.signal.reason;
    this.assertUrlAllowed(url);
    // Caché (memoria o Redis) aislada por scope de credenciales. Si falla
    // (Redis caído), se ignora sin romper el scraping.
    const key = this.cacheKey(url);
    try {
      const cached = await this.pageCache.get(key);
      if (cached !== null && cached !== undefined) return { html: cached };
    } catch { /* cache miss/error → fetch */ }
    await this.applyRateLimit(url);
    let html: string;
    let statusCode: number | undefined;
    if (this.deps?.fetcher) {
      html = await abortable(this.deps.fetcher(url, this.deps.signal), this.deps.signal);
    } else {
      if (this.deps?.crawlPage) await abortable(this.deps.crawlPage(url), this.deps.signal);
      const fetched = await defaultFetchHtml(url, {
        headers: this.deps?.headers,
        credentialOrigin: this.credentialOrigin,
        allowedDomain: this.allowedDomain,
        signal: this.deps?.signal,
      });
      html = fetched.html;
      statusCode = fetched.statusCode;
    }
    try {
      await this.pageCache.set(key, html);
    } catch { /* noop */ }
    return statusCode === undefined ? { html } : { html, statusCode };
  }

  /** Registra una URL visitada: deduplica O(1) y acota la memoria (FIFO). */
  private markVisited(url: string): void {
    if (this.visitedSet.has(url)) return;
    this.visitedSet.add(url);
    this.memory.visited.push(url);
    if (this.memory.visited.length > this.maxVisited) {
      const evicted = this.memory.visited.shift();
      if (evicted !== undefined) this.visitedSet.delete(evicted);
    }
  }

  private async loadUrl(url: string): Promise<void> {
    this.assertUrlAllowed(url);
    const { html, statusCode } = await this.fetchHtml(url);
    this.$ = cheerio.load(html);
    this.currentHtml = html;
    this.currentUrl = url;
    this.lastStatusCode = statusCode;
    this.currentHtmlLength = html.length;
    this.networkResponses = [];
    this.markVisited(url);
    this.memory.lastUrl = url;
  }

  /** Carga HTML ya obtenido (p.ej. tras interacción browser) sin refetch. */
  private loadHtml(url: string, html: string): void {
    this.assertUrlAllowed(url);
    this.$ = cheerio.load(html);
    this.currentHtml = html;
    this.currentUrl = url;
    this.currentHtmlLength = html.length;
    this.markVisited(url);
    this.memory.lastUrl = url;
  }

  /**
   * Render-on-demand (A, bloque 1): si hay delegado browser y la página no se
   * renderizó ya en este job, la carga en Chromium y sustituye el DOM. Devuelve
   * true si el render se aplicó; false si no hay browser, ya se hizo, o falló.
   */
  private async maybeRender(force = false): Promise<boolean> {
    const interact = this.deps?.browserInteract;
    const url = this.currentUrl;
    if (!interact || !url) return false;
    const render = this.deps?.render;
    if (render?.mode === 'never') return false;
    if (!force && render?.mode !== 'always') {
      const challenge = detectChallenge(this.currentHtml ?? '');
      const thin = needsBrowserRender(this.currentHtml ?? '');
      if (!challenge && !thin) return false;
    }
    const key = normalizeUrlForDedupe(url);
    if (this.renderedUrls.has(key)) return false;
    try {
      const out = await interact(url, { kind: 'render', ...(render ? { render } : {}) }, this.deps?.signal);
      this.renderedUrls.add(key);
      this.loadHtml(out.url, out.html);
      this.networkResponses = out.network ?? [];
      return true;
    } catch (e) {
      if (this.deps?.signal?.aborted) throw this.deps.signal.reason;
      logger.warn('render_fallback_failed', { url, error: (e as Error).message });
      return false;
    }
  }

  private requirePage(): cheerio.CheerioAPI {
    if (!this.$ || !this.currentUrl) throw new Error('Sin página cargada: emite NAVIGATE primero');
    return this.$;
  }

  /** Extrae items con un selector concreto; el `_source.selector` refleja el real (R-SC-12). */
  private extractListOnce(
    selector: string,
    limit: number,
    fields: Record<string, FieldSpec>,
  ): { items: Record<string, unknown>[]; count: number } {
    const $ = this.requirePage();
    const items: Record<string, unknown>[] = [];
    const cards = $(selector);
    logger.debug('extract_list.start', { selector, limit, cardsFound: cards.length, fields: Object.keys(fields), url: this.currentUrl });
    cards.each((_, card) => {
      if (items.length >= limit) return false;
      const row: Record<string, unknown> = {};
      for (const [k, spec] of Object.entries(fields)) {
        const extracted = extractFieldValue($, $(card), spec);
        row[k] = {
          value: extracted.value,
          source: { url: this.currentUrl, selector: `${selector} ${extracted.selector}`, scrapedAt: new Date().toISOString() },
        };
      }
      row._source = { url: this.currentUrl, selector, scrapedAt: new Date().toISOString() };
      items.push(row);
    });
    return { items, count: items.length };
  }

  /** Lista de selectores aprendidos candidatos (sin el que falló). Degrada a [] si la memoria falla. */
  private async getFallbackSelectors(failedSelector: string): Promise<string[]> {
    const provider = this.deps?.fallbackSelectors;
    if (!provider) return [];
    try {
      const list = await provider();
      return list.filter((s) => typeof s === 'string' && s.length > 0 && s !== failedSelector).slice(0, 5);
    } catch {
      return [];
    }
  }

  /**
   * EXTRACT_LIST con render-on-demand (A, bloque 1) y fallback a selectores aprendidos
   * (C, bloque 3): si el selector de la IA da 0 elementos, reintenta tras render y, si
   * sigue vacío, prueba los selectores aprendidos del dominio antes de devolver el error.
   */
  private async extractList(cmd: LooseCommand): Promise<ExecutionResult> {
    const selector = cmd.selector!;
    const fields = cmd.fields!;
    const limit = Math.min(cmd.limit ?? 100, 1000);
    const first = this.extractListOnce(selector, limit, fields);
    if (first.count > 0) {
      this.memory.lastItems = first.count;
      logger.debug('extract_list.done', { extracted: first.count, url: this.currentUrl });
      return { ok: true, commandType: 'EXTRACT_LIST', items: first.items, count: first.count };
    }
    if (this.deps?.browserInteract && needsBrowserRender(this.currentHtml ?? '')) {
      if (await this.maybeRender()) {
        const retried = this.extractListOnce(selector, limit, fields);
        if (retried.count > 0) {
          this.memory.lastItems = retried.count;
          logger.debug('extract_list.done', { extracted: retried.count, url: this.currentUrl });
          return { ok: true, commandType: 'EXTRACT_LIST', items: retried.items, count: retried.count, usedBrowser: true };
        }
      }
    }
    const learned = await this.getFallbackSelectors(selector);
    for (const alt of learned) {
      const altResult = this.extractListOnce(alt, limit, fields);
      if (altResult.count > 0) {
        this.memory.lastItems = altResult.count;
        logger.warn('extract_list.learned_fallback', { failed: selector, used: alt, count: altResult.count, url: this.currentUrl });
        return { ok: true, commandType: 'EXTRACT_LIST', items: altResult.items, count: altResult.count, nextHint: `selector aprendido: ${alt}` };
      }
    }
    return {
      ok: false,
      commandType: 'EXTRACT_LIST',
      error: `0 elementos para selector "${selector}" → Recovery (§28): probar INSPECT_ELEMENTS`,
    };
  }

  private extractNetwork(cmd: LooseCommand): ExecutionResult {
    const limit = Math.min(Math.max(Math.floor(cmd.limit ?? 100), 1), 1000);
    const scrapedAt = new Date().toISOString();
    const responses = this.networkResponses.filter((response) =>
      !cmd.urlContains || response.url.includes(cmd.urlContains),
    );
    if (responses.length === 0) {
      return {
        ok: false,
        commandType: 'EXTRACT_NETWORK',
        error: 'sin respuestas JSON capturadas; usa render.mode=always y espera la carga de la SPA',
      };
    }

    const readPath = (value: unknown, path: string): unknown => {
      let current: unknown = value;
      for (const part of path.split('.').filter(Boolean)) {
        if (!current || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[part];
      }
      return current;
    };

    const items: unknown[] = [];
    for (const response of responses) {
      if (items.length >= limit) break;
      let parsed: unknown;
      try { parsed = JSON.parse(response.body); } catch { continue; }
      const selected = cmd.path ? readPath(parsed, cmd.path) : parsed;
      if (selected === undefined) continue;
      const rows = Array.isArray(selected) ? selected : [selected];
      for (const row of rows) {
        if (items.length >= limit) break;
        const item: Record<string, unknown> = row && typeof row === 'object' && !Array.isArray(row)
          ? { ...(row as Record<string, unknown>) }
          : { value: row };
        item._source = { url: response.url, selector: 'network', kind: 'network', scrapedAt };
        items.push(item);
      }
    }

    if (items.length === 0) {
      return { ok: false, commandType: 'EXTRACT_NETWORK', error: 'ninguna respuesta JSON coincidió con el filtro/path' };
    }
    this.memory.lastItems = items.length;
    logger.debug('extract_network.done', { count: items.length, responses: responses.length, url: this.currentUrl });
    return { ok: true, commandType: 'EXTRACT_NETWORK', items, count: items.length };
  }

  private extractStructured(cmd: LooseCommand): ExecutionResult {
    const $ = this.requirePage();
    const source = cmd.source ?? 'auto';
    const limit = Math.min(Math.max(Math.floor(cmd.limit ?? 100), 1), 1000);
    const scrapedAt = new Date().toISOString();
    const items: Record<string, unknown>[] = [];

    const flatten = (entity: Record<string, unknown>, prefix = ''): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const [rawKey, value] of Object.entries(entity)) {
        if (rawKey === '@context' || value === null || value === undefined) continue;
        const key = `${prefix}${rawKey === '@type' ? 'type' : rawKey.replace(/^@/, '')}`;
        if (Array.isArray(value)) {
          const primitives = value.filter((entry) => entry === null || typeof entry !== 'object');
          if (primitives.length > 0) out[key] = primitives.join(', ');
          else if (value[0] && typeof value[0] === 'object') {
            out[key] = value.map((entry) => JSON.stringify(entry)).join(' | ').slice(0, 2000);
          }
        } else if (typeof value === 'object') {
          Object.assign(out, flatten(value as Record<string, unknown>, `${key}.`));
        } else {
          out[key] = value;
        }
      }
      return out;
    };

    if (source === 'auto' || source === 'jsonld') {
      $('script[type="application/ld+json"]').each((_index, element) => {
        if (items.length >= limit) return false;
        const raw = $(element).html();
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw) as unknown;
          const entities = Array.isArray(parsed)
            ? parsed
            : (parsed && typeof parsed === 'object' && '@graph' in (parsed as Record<string, unknown>)
              ? (parsed as Record<string, unknown>)['@graph']
              : [parsed]);
          for (const entity of Array.isArray(entities) ? entities : [entities]) {
            if (items.length >= limit) break;
            if (!entity || typeof entity !== 'object' || Array.isArray(entity)) continue;
            const flat = flatten(entity as Record<string, unknown>);
            if (Object.keys(flat).length === 0) continue;
            flat._source = { url: this.currentUrl, selector: 'script[type="application/ld+json"]', kind: 'jsonld', scrapedAt };
            items.push(flat);
          }
        } catch {
          logger.debug('structured.jsonld_invalid', { url: this.currentUrl });
        }
      });
    }

    if ((source === 'auto' || source === 'opengraph') && items.length < limit) {
      const og: Record<string, unknown> = {};
      $('meta[property^="og:"], meta[name^="og:"]').each((_index, element) => {
        const property = ($(element).attr('property') ?? $(element).attr('name') ?? '').replace(/^og:/, '');
        const content = $(element).attr('content');
        if (property && content) og[property] = content;
      });
      if (Object.keys(og).length > 0) {
        og._source = { url: this.currentUrl, selector: 'meta[property^="og:"]', kind: 'opengraph', scrapedAt };
        items.push(og);
      }
    }

    if ((source === 'auto' || source === 'microdata') && items.length < limit) {
      $('[itemscope]').each((_index, element) => {
        if (items.length >= limit) return false;
        const scope = $(element);
        const itemtype = scope.attr('itemtype') ?? '';
        const record: Record<string, unknown> = {};
        if (itemtype) record.type = itemtype.split('/').filter(Boolean).pop();
        scope.find('[itemprop]').each((_propIndex, prop) => {
          const name = $(prop).attr('itemprop');
          if (!name) return;
          const value = $(prop).attr('content') ?? $(prop).attr('href') ?? $(prop).attr('src')
            ?? $(prop).attr('datetime') ?? $(prop).text().replace(/\s+/g, ' ').trim();
          if (value) record[name] = value.slice(0, 2000);
        });
        if (Object.keys(record).length <= (itemtype ? 1 : 0)) return;
        record._source = { url: this.currentUrl, selector: '[itemscope]', kind: 'microdata', scrapedAt };
        items.push(record);
      });
    }

    if (items.length === 0) {
      return { ok: false, commandType: 'EXTRACT_STRUCTURED', error: `sin datos estructurados (${source})` };
    }
    this.memory.lastItems = items.length;
    logger.debug('extract_structured.done', { count: items.length, source, url: this.currentUrl });
    return { ok: true, commandType: 'EXTRACT_STRUCTURED', items: items.slice(0, limit), count: Math.min(items.length, limit) };
  }

  private extractTable(cmd: LooseCommand): ExecutionResult {
    const $ = this.requirePage();
    if (!cmd.selector) return { ok: false, commandType: 'EXTRACT_TABLE', error: 'selector requerido' };
    const limit = Math.min(Math.max(Math.floor(cmd.limit ?? 100), 1), 1000);
    const scrapedAt = new Date().toISOString();
    const items: Record<string, unknown>[] = [];

    $(cmd.selector).each((_tableIndex, table) => {
      if (items.length >= limit) return false;
      const tableEl = $(table);
      const headRow = tableEl.find('thead tr').first();
      const firstRow = tableEl.find('tr').first();
      const headerCells = headRow.length > 0
        ? headRow.find('th,td')
        : (firstRow.find('th').length > 0 ? firstRow.find('th,td') : null);
      const names: string[] = [];
      if (headerCells) {
        headerCells.each((_index, cell) => {
          names.push($(cell).text().replace(/\s+/g, ' ').trim().slice(0, 200));
        });
      }

      let bodyRows = headRow.length > 0
        ? tableEl.find('tbody tr')
        : tableEl.find('tr');
      if (!headRow.length && headerCells) bodyRows = bodyRows.slice(1);

      bodyRows.each((rowIndex, row) => {
        if (items.length >= limit) return false;
        const cells: string[] = [];
        $(row).find('td,th').each((_index, cell) => {
          cells.push($(cell).text().replace(/\s+/g, ' ').trim().slice(0, 2000));
        });
        if (cells.length === 0) return;
        const record: Record<string, unknown> = {};
        cells.forEach((value, index) => {
          record[names[index] || `column${index + 1}`] = value;
        });
        record._source = {
          url: this.currentUrl,
          selector: `${cmd.selector} tr:nth-child(${rowIndex + 1})`,
          scrapedAt,
        };
        items.push(record);
      });
    });

    if (items.length === 0) {
      return { ok: false, commandType: 'EXTRACT_TABLE', error: `0 filas para selector "${cmd.selector}"` };
    }
    this.memory.lastItems = items.length;
    logger.debug('extract_table.done', { rows: items.length, url: this.currentUrl });
    return { ok: true, commandType: 'EXTRACT_TABLE', items, count: items.length };
  }

  private extractText(cmd: LooseCommand): ExecutionResult {
    const $ = this.requirePage();
    const selector = cmd.selector ?? 'body';
    const maxLength = Math.min(Math.max(Math.floor(cmd.maxLength ?? 5000), 1), 10000);
    const element = $(selector).first();
    if (element.length === 0) {
      return { ok: false, commandType: 'EXTRACT_TEXT', error: `selector no encontrado: ${selector}` };
    }
    const text = element.text().replace(/\s+/g, ' ').trim().slice(0, maxLength);
    if (!text) {
      return { ok: false, commandType: 'EXTRACT_TEXT', error: `texto vacío en selector "${selector}"` };
    }
    const item = {
      text,
      _source: { url: this.currentUrl, selector, scrapedAt: new Date().toISOString() },
    };
    this.memory.lastItems = 1;
    logger.debug('extract_text.done', { length: text.length, url: this.currentUrl });
    return { ok: true, commandType: 'EXTRACT_TEXT', items: [item], count: 1, data: { text, length: text.length } };
  }

  /** Cortesía por host (H, bloque 4): se espera antes de un fetch real; si el limitador falla, no rompe. */
  private async applyRateLimit(url: string): Promise<void> {
    const limiter = this.deps?.rateLimit;
    if (!limiter) return;
    try {
      await limiter(new URL(url).hostname.toLowerCase(), this.deps?.signal);
    } catch (e) {
      if (this.deps?.signal?.aborted) throw this.deps.signal.reason;
      logger.warn('rate_limit_failed', { url, error: (e as Error).message });
    }
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
          let usedBrowser = false;
          let challenge = detectChallenge(this.currentHtml ?? '');
          const thin = needsBrowserRender(this.currentHtml ?? '');
          const renderMode = this.deps?.render?.mode ?? 'auto';
          // Render-on-demand (A), escape de anti-bot (E) y modo `always` para SPAs.
          if (this.deps?.browserInteract && (renderMode === 'always' || ((challenge === 'cloudflare' || thin) && renderMode !== 'never'))) {
            if (await this.maybeRender(renderMode === 'always')) {
              usedBrowser = true;
              challenge = detectChallenge(this.currentHtml ?? '');
            }
          }
          if (challenge === 'cloudflare') {
            logger.warn('antibot_challenge', { url: cmd.url, kind: challenge, usedBrowser });
            return {
              ok: false,
              commandType: 'NAVIGATE',
              usedBrowser,
              statusCode: this.lastStatusCode,
              error: `anti-bot challenge detectado (${challenge})`,
            };
          }
          if (challenge) logger.debug('antibot_marker', { url: cmd.url, kind: challenge });
          const title = this.$!('title').first().text().trim().slice(0, 200);
          logger.debug('navigate', { url: cmd.url, title, htmlLength: this.currentHtmlLength, usedBrowser });
          return { ok: true, commandType: 'NAVIGATE', count: this.currentHtmlLength, statusCode: this.lastStatusCode, usedBrowser, nextHint: title || cmd.url };
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
              structured: {
                jsonLd: $('script[type="application/ld+json"]').length,
                openGraph: $('meta[property^="og:"]').length,
                microdata: $('[itemscope]').length,
              },
              network: {
                count: this.networkResponses.length,
                responses: this.networkResponses.slice(0, 10).map((response) => ({
                  url: response.url,
                  status: response.status,
                  contentType: response.contentType,
                  size: response.body.length,
                })),
              },
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
            if (this.memory.discoveredSelectors.length > 20) this.memory.discoveredSelectors.shift();
          }
          return { ok: true, commandType: 'INSPECT_ELEMENTS', items: out, count: out.length };
        }

        case 'EXTRACT': {
          const $ = this.requirePage();
          if (!cmd.fields) return { ok: false, commandType: 'EXTRACT', error: 'EXTRACT requiere fields' };
          const obj: Record<string, unknown> = {};
          const usedSelectors: string[] = [];
          for (const [k, spec] of Object.entries(cmd.fields)) {
            const extracted = extractFieldValue($, $, spec);
            usedSelectors.push(extracted.selector);
            obj[k] = {
              value: extracted.value,
              source: {
                url: this.currentUrl,
                selector: extracted.selector,
                scrapedAt: new Date().toISOString(),
              },
            };
          }
          obj._source = {
            url: this.currentUrl,
            selector: [...new Set(usedSelectors)].join(', ').slice(0, 500),
            scrapedAt: new Date().toISOString(),
          };
          this.memory.lastItems = 1;
          logger.debug('extract', { fields: Object.keys(cmd.fields), url: this.currentUrl });
          return { ok: true, commandType: 'EXTRACT', items: [obj], count: 1 };
        }

        case 'EXTRACT_LIST':
          return await this.extractList(cmd);

        case 'EXTRACT_TABLE':
          return this.extractTable(cmd);

        case 'EXTRACT_TEXT':
          return this.extractText(cmd);

        case 'EXTRACT_STRUCTURED':
          return this.extractStructured(cmd);

        case 'EXTRACT_NETWORK':
          return this.extractNetwork(cmd);

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
              this.networkResponses = out.network ?? [];
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
              this.networkResponses = out.network ?? [];
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
          const selector = cmd.selector;
          const maxLinks = Math.min(cmd.maxLinks ?? 10, 100);
          const baseHost = new URL(this.currentUrl!).hostname;
          const hrefs: string[] = [];
          const seen = new Set<string>();
          $(selector).each((_, el) => {
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
          type FollowItem = {
            url: string;
            title: string;
            htmlLength: number;
            _source: { url: string; selector: string; scrapedAt: string };
          };
          // ETAPA 3+6: no refetchear URLs ya visitadas; la caché evita refetch entre comandos.
          const seenVisited = new Set(this.memory.visited.map((v) => normalizeUrlForDedupe(v)));
          const pending = hrefs.filter((h) => !seenVisited.has(normalizeUrlForDedupe(h)));
          // F (bloque 2): fetch en paralelo acotado, preservando el orden de los enlaces.
          const results: Array<FollowItem | undefined> = new Array(pending.length);
          let cursor = 0;
          const run = async (): Promise<void> => {
            for (;;) {
              const index = cursor;
              cursor += 1;
              if (index >= pending.length) return;
              const href = pending[index]!;
              const scrapedAt = new Date().toISOString();
              try {
                const { html } = await this.fetchHtml(href);
                const $$ = cheerio.load(html);
                results[index] = {
                  url: href,
                  title: $$('title').first().text().trim().slice(0, 200),
                  htmlLength: html.length,
                  _source: { url: href, selector, scrapedAt },
                };
                this.markVisited(href);
              } catch (e) {
                if (this.deps?.signal?.aborted) throw this.deps.signal.reason;
                results[index] = {
                  url: href,
                  title: `ERROR: ${(e as Error).message}`,
                  htmlLength: 0,
                  _source: { url: href, selector, scrapedAt },
                };
              }
            }
          };
          const workers = Math.min(FOLLOW_LINKS_CONCURRENCY, pending.length);
          await Promise.all(Array.from({ length: workers }, () => run()));
          const visited = results.filter((item): item is FollowItem => item !== undefined);
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
