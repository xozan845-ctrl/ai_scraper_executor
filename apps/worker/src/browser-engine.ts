/**
 * Factoría del engine de producción (ETAPA 3/6 + Redis).
 * HTTP primero (Cheerio); CLICK no-enlace y SCROLL escalan a Chromium real
 * vía CrawlerService.interact. La caché de páginas usa Redis (compartida entre
 * réplicas `--scale worker=N`); si Redis no responde, el engine sigue sin caché
 * (degradación silenciosa segura, los errores de caché se ignoran).
 */
import { CrawlerService } from '@ai-scraper/crawler';
import { ExecutionEngine } from '@ai-scraper/execution-engine';
import { RedisPageCache } from '@ai-scraper/redis';

const crawler = new CrawlerService();
const sharedCache = new RedisPageCache();

export function createProductionEngine(): ExecutionEngine {
  return new ExecutionEngine({
    browserInteract: (url, action) => crawler.interact(url, action),
    pageCache: sharedCache,
  });
}
