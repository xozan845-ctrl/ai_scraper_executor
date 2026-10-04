/**
 * Factoría del engine de producción (ETAPA 3, §34 + FASE 11, ETAPA 6).
 * HTTP primero (Cheerio); CLICK no-enlace y SCROLL escalan a Chromium real
 * vía CrawlerService.interact. La PageCache compartida evita refetchear
 * el mismo HTML entre engines de la réplica. Sin esta factoría (tests)
 * el engine sigue devolviendo { needsBrowser: true } sin lanzar browser.
 */
import { CrawlerService } from '@ai-scraper/crawler';
import { ExecutionEngine, PageCache } from '@ai-scraper/execution-engine';

const crawler = new CrawlerService();
const sharedCache = new PageCache();

export function createProductionEngine(): ExecutionEngine {
  return new ExecutionEngine({
    browserInteract: (url, action) => crawler.interact(url, action),
    pageCache: sharedCache,
  });
}
