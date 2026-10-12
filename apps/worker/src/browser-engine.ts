/**
 * Factoría del engine de producción (ETAPA 3/6 + Redis).
 * HTTP primero (Cheerio); CLICK no-enlace y SCROLL escalan a Chromium real
 * vía CrawlerService.interact. La caché de páginas usa Redis (compartida entre
 * réplicas `--scale worker=N`) con fallback a memoria; el engine ignora errores
 * de caché, así que un Redis caído no rompe el scraping.
 */
import { CrawlerService } from '@ai-scraper/infrastructure-crawler';
import { ExecutionEngine, type EnginePageCache } from '@ai-scraper/infrastructure-execution';
import { getPageCache, getRateLimiter } from '@ai-scraper/infrastructure-redis';

const crawler = new CrawlerService();

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name] ?? '');
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

interface HostLimiter {
  consume(identifier: string, cost?: number): Promise<{ allowed: boolean; remaining: number; resetAt: number }>;
}

/** Limitador por host del propio worker (singleton perezoso; fallback a memoria, R-RD-5). */
let hostLimiterPromise: Promise<HostLimiter> | null = null;
function getHostLimiter(): Promise<HostLimiter> {
  if (!hostLimiterPromise) {
    hostLimiterPromise = getRateLimiter({ max: envInt('ENGINE_HOST_MAX_RPM', 30), windowMs: 60_000 });
  }
  return hostLimiterPromise;
}

const HOST_RATE_LIMIT_WAIT_CAP_MS = 10_000;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Cortesía con el sitio objetivo: limita peticiones por host (H, bloque 4). */
async function rateLimitHost(host: string, signal?: AbortSignal): Promise<void> {
  const limiter = await getHostLimiter();
  const { allowed, resetAt } = await limiter.consume(`host:${host}`);
  if (allowed) return;
  await sleep(Math.min(Math.max(0, resetAt - Date.now()), HOST_RATE_LIMIT_WAIT_CAP_MS), signal);
}

/** Proxy que resuelve la caché real (Redis con fallback) de forma perezosa. */
class LazyPageCache implements EnginePageCache {
  private real: EnginePageCache | null = null;

  private async resolve(): Promise<EnginePageCache> {
    if (!this.real) this.real = (await getPageCache()) as EnginePageCache;
    return this.real;
  }

  async get(url: string): Promise<string | null> {
    return (await this.resolve()).get(url) as Promise<string | null>;
  }

  async set(url: string, html: string): Promise<void> {
    await (await this.resolve()).set(url, html);
  }
}

const sharedCache = new LazyPageCache();

export interface EngineOptions {
  /** Headers de sesión (Authorization/Cookie) aplicados a HTTP y browser. */
  headers?: Record<string, string>;
  allowedDomain?: string;
  credentialOrigin?: string;
  signal?: AbortSignal;
  /** Selectores aprendidos del dominio para el fallback de EXTRACT_LIST (C, bloque 3). */
  learnedSelectors?: string[];
}

export function createProductionEngine(opts?: EngineOptions): ExecutionEngine {
  const interactOpts = {
    ...(opts?.headers ? { headers: opts.headers } : {}),
    ...(opts?.allowedDomain ? { allowedDomain: opts.allowedDomain } : {}),
    ...(opts?.credentialOrigin ? { credentialOrigin: opts.credentialOrigin } : {}),
  };
  return new ExecutionEngine({
    browserInteract: (url, action, signal) => crawler.interact(url, action, { ...interactOpts, signal }),
    pageCache: sharedCache,
    rateLimit: rateLimitHost,
    ...interactOpts,
    ...(opts?.signal ? { signal: opts.signal } : {}),
    ...(opts?.learnedSelectors && opts.learnedSelectors.length > 0
      ? { fallbackSelectors: () => Promise.resolve(opts.learnedSelectors ?? []) }
      : {}),
  });
}

/** Cierra el navegador compartido (apagado graceful). */
export async function closeProductionBrowser(): Promise<void> {
  await crawler.close();
}
