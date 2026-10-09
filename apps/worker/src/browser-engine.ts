/**
 * Factoría del engine de producción (ETAPA 3/6 + Redis).
 * HTTP primero (Cheerio); CLICK no-enlace y SCROLL escalan a Chromium real
 * vía CrawlerService.interact. La caché de páginas usa Redis (compartida entre
 * réplicas `--scale worker=N`) con fallback a memoria; el engine ignora errores
 * de caché, así que un Redis caído no rompe el scraping.
 */
import { CrawlerService } from '@ai-scraper/crawler';
import { ExecutionEngine, type EnginePageCache } from '@ai-scraper/execution-engine';
import { getPageCache } from '@ai-scraper/redis';

const crawler = new CrawlerService();

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
}

export function createProductionEngine(opts?: EngineOptions): ExecutionEngine {
  return new ExecutionEngine({
    browserInteract: (url, action, signal) => crawler.interact(url, action, { ...opts, signal }),
    pageCache: sharedCache,
    ...(opts?.headers ? { headers: opts.headers } : {}),
    ...(opts?.allowedDomain ? { allowedDomain: opts.allowedDomain } : {}),
    ...(opts?.credentialOrigin ? { credentialOrigin: opts.credentialOrigin } : {}),
    ...(opts?.signal ? { signal: opts.signal } : {}),
  });
}

/** Cierra el navegador compartido (apagado graceful). */
export async function closeProductionBrowser(): Promise<void> {
  await crawler.close();
}
