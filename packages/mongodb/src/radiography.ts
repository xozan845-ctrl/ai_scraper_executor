import { CrawlerService, CrawlMode } from '@ai-scraper/crawler';
import { ExecutionEngine } from '@ai-scraper/execution-engine';
import { mongoRepo, normalizeDomain } from './repository';
import { ISiteProfile, DiscoveredSelector, PaginationPattern } from './models';

/** Resultado de una radiografía completa */
export interface RadiographyResult {
  profile: ISiteProfile;
  /** true si el HTML cambió respecto a la última radiografía (drift). */
  changed?: boolean;
  radiography: {
    url: string;
    title: string;
    structure: {
      lists: Array<{ selector: string; count: number; sampleItems: unknown[] }>;
      forms: Array<{ selector: string; fields: string[] }>;
      scripts: number;
      stylesheets: number;
    };
    loadTimeMs: number;
    usedBrowser: boolean;
  };
  discovered: {
    listSelectors: DiscoveredSelector[];
    detailSelectors: DiscoveredSelector[];
    navigationSelectors: DiscoveredSelector[];
    pagination: PaginationPattern | null;
  };
}

/** Realiza radiografía completa de un sitio (FASE 12: Memoria) */
export async function performRadiography(
  url: string,
  options?: { maxDepth?: number; maxPages?: number; forceBrowser?: boolean; headers?: Record<string, string> }
): Promise<RadiographyResult> {
  const domain = normalizeDomain(url);
  const profile = await mongoRepo.getOrCreateProfile(domain, url);
  const crawler = new CrawlerService();
  const engine = new ExecutionEngine();

  console.log(`[RADIOGRAPHY] Iniciando para ${domain}`);

  // 1. Crawl inicial (HTTP primero, browser si necesario)
  const crawlInput = {
    url,
    mode: (options?.forceBrowser ? 'browser' : 'hybrid') as CrawlMode,
    maxDepth: options?.maxDepth ?? 2,
    maxRequests: options?.maxPages ?? 20,
    maxConcurrency: 3,
    ...(options?.headers ? { headers: options.headers } : {}),
  };

  const started = Date.now();
  const { pages, stats } = await crawler.crawlDetailed(crawlInput);
  const usedBrowser = stats.usedBrowser;

  if (pages.length === 0) {
    throw new Error(`No se pudo crawlear ${url}`);
  }

  // 2. Analizar página principal en profundidad
  const mainPage = pages[0];
  await engine.execute({ type: 'NAVIGATE', url: mainPage.url });

  // INSPECT_PAGE completo
  const _pageInspect = await engine.execute({ type: 'INSPECT_PAGE' });
  const linksInspect = await engine.execute({ type: 'INSPECT_LINKS' });
  const elementsInspect = await engine.execute({ type: 'INSPECT_ELEMENTS' });

  // 3. Detectar selectores de lista (productos, artículos, etc.)
  const listSelectors: DiscoveredSelector[] = [];
  const detailSelectors: DiscoveredSelector[] = [];
  const navigationSelectors: DiscoveredSelector[] = [];

  for (const el of (elementsInspect.items as Array<{ type: string; selector: string; text: string }> | undefined) ?? []) {
    const sel: DiscoveredSelector = {
      selector: el.selector,
      type: el.type === 'product' ? 'product' : 'list',
      confidence: 0.7,
      sampleText: el.text,
      pageUrls: [mainPage.url],
      timesUsed: 0,
      successRate: 0.5,
    };
    if (el.type === 'product') {
      detailSelectors.push(sel);
    } else {
      listSelectors.push(sel);
    }
  }

  // Detectar navegación (menús, categorías)
  for (const link of (linksInspect.items as Array<{ text: string; href: string }> | undefined) ?? []) {
    if (/categor|menu|nav|filter|category/i.test(link.text)) {
      navigationSelectors.push({
        selector: `a[href="${link.href}"]`,
        type: 'navigation',
        confidence: 0.6,
        sampleText: link.text,
        pageUrls: [mainPage.url],
        timesUsed: 0,
        successRate: 0.5,
      });
    }
  }

  // 4. Detectar paginación
  let pagination: PaginationPattern | null = null;
  const pageLinks = (linksInspect.items as Array<{ text: string; href: string }> | undefined) ?? [];
  const pageLink = pageLinks.find((l) => /page|página|siguiente|next/i.test(l.text));
  if (pageLink) {
    const match = pageLink.href.match(/[?&]page=(\d+)/);
    if (match) {
      pagination = {
        type: 'query',
        pattern: pageLink.href.replace(match[1], '{n}'),
        confidence: 0.8,
      };
    } else {
      pagination = {
        type: 'next-link',
        selector: `a[href="${pageLink.href}"]`,
        confidence: 0.7,
      };
    }
  }

  // 5. Detectar si es JS-heavy
  const isJavaScriptHeavy = usedBrowser || stats.pagesOk === 0 || pages.some((p) => p.links.length < 3 && p.htmlLength < 5000);

  // 6. Actualizar perfil en MongoDB
  await mongoRepo.updateSelectors(profile.id!, {
    listSelectors,
    detailSelectors,
    navigationSelectors,
    pagination,
    isJavaScriptHeavy,
    recommendedLimits: {
      maxPages: isJavaScriptHeavy ? 50 : 100,
      maxDepth: 3,
      needsBrowser: isJavaScriptHeavy,
    },
  });

  // 6. Detectar drift: ¿cambió el HTML respecto a la última radiografía?
  const previous = await mongoRepo.findFreshRadiography(mainPage.url, 24 * 3650).catch(() => null);
  const changed = Boolean(previous?.htmlHash && previous.htmlHash !== mainPage.htmlHash);
  if (changed) {
    console.warn(`[RADIOGRAPHY] cambio detectado en ${mainPage.url} (hash ${previous?.htmlHash} → ${mainPage.htmlHash})`);
  }

  // 7. Guardar radiografía real (hash del HTML + estructura con conteos).
  const structure = {
    lists: (mainPage.elementCounts ?? []).map((ec) => ({ selector: ec.selector, count: ec.count, sampleItems: [] })),
    forms: [] as Array<{ selector: string; fields: string[] }>,
    scripts: 0,
    stylesheets: 0,
  };
  await mongoRepo.saveRadiography({
    url: mainPage.url,
    profileId: profile.id!,
    htmlHash: mainPage.htmlHash,
    title: mainPage.title,
    structure,
    statusCode: mainPage.statusCode ?? 200,
    loadTimeMs: stats.durationMs,
    usedBrowser,
    ttlHours: 24,
  });

  console.log(`[RADIOGRAPHY] Completada para ${domain} en ${Date.now() - started}ms (browser: ${usedBrowser}, changed: ${changed})`);

  return {
    profile,
    changed,
    radiography: {
      url: mainPage.url,
      title: mainPage.title,
      structure,
      loadTimeMs: stats.durationMs,
      usedBrowser,
    },
    discovered: {
      listSelectors,
      detailSelectors,
      navigationSelectors,
      pagination,
    },
  };
}

/** Obtiene el perfil aprendido para usar en scraping posterior */
export async function getLearnedProfile(url: string): Promise<{
  profile: ISiteProfile | null;
  shouldUseBrowser: boolean;
  recommendedSelectors: {
    list: string[];
    detail: string[];
    pagination: PaginationPattern | null;
  };
}> {
  const domain = normalizeDomain(url);
  const profile = await mongoRepo.findProfile(domain);

  if (!profile) {
    return { profile: null, shouldUseBrowser: false, recommendedSelectors: { list: [], detail: [], pagination: null } };
  }

  // Selectores con mayor confianza y uso
  const list = profile.listSelectors
    .filter((s: DiscoveredSelector) => s.confidence > 0.5)
    .sort((a: DiscoveredSelector, b: DiscoveredSelector) => b.confidence - a.confidence || b.timesUsed - a.timesUsed)
    .map((s: DiscoveredSelector) => s.selector);

  const detail = profile.detailSelectors
    .filter((s: DiscoveredSelector) => s.confidence > 0.5)
    .sort((a: DiscoveredSelector, b: DiscoveredSelector) => b.confidence - a.confidence || b.timesUsed - a.timesUsed)
    .map((s: DiscoveredSelector) => s.selector);

  return {
    profile,
    shouldUseBrowser: profile.isJavaScriptHeavy ?? false,
    recommendedSelectors: {
      list,
      detail,
      pagination: profile.pagination,
    },
  };
}