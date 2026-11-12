import { normalizeDomain } from '@ai-scraper/shared-security';
import type { DiscoveredSelector, PaginationPattern } from '@ai-scraper/domain-scraper';
import type { ScraperEngine } from '../ports/scraper-engine';
import type {
  RadiographyOptions,
  RadiographyProfileRepository,
  RadiographyResult,
  SiteCrawler,
} from '../ports/radiography';

export interface RadiographyDeps {
  crawler: SiteCrawler;
  engine: ScraperEngine;
  repository: RadiographyProfileRepository;
}

/**
 * Radiografía completa de un sitio: crawl, inspección del DOM, detección de
 * selectores/paginación y persistencia del perfil. Coordina puertos; no conoce
 * Mongo, Crawlee ni Playwright (`R-HX-12`).
 */
export async function performRadiography(
  url: string,
  options: RadiographyOptions | undefined,
  deps: RadiographyDeps,
): Promise<RadiographyResult> {
  const domain = normalizeDomain(url, { stripWww: true });
  const profile = await deps.repository.getOrCreateProfile(domain, url);

  console.log(`[RADIOGRAPHY] Iniciando para ${domain}`);

  const started = Date.now();
  const { pages, stats } = await deps.crawler.crawlDetailed({
    url,
    mode: options?.forceBrowser ? 'browser' : 'hybrid',
    maxDepth: options?.maxDepth ?? 2,
    maxRequests: options?.maxPages ?? 20,
    maxConcurrency: 3,
    ...(options?.headers ? { headers: options.headers } : {}),
  });
  const usedBrowser = stats.usedBrowser;

  if (pages.length === 0) throw new Error(`No se pudo crawlear ${url}`);

  const mainPage = pages[0];
  await deps.engine.execute({ type: 'NAVIGATE', url: mainPage.url });
  await deps.engine.execute({ type: 'INSPECT_PAGE' });
  const linksInspect = await deps.engine.execute({ type: 'INSPECT_LINKS' });
  const elementsInspect = await deps.engine.execute({ type: 'INSPECT_ELEMENTS' });

  const listSelectors: DiscoveredSelector[] = [];
  const detailSelectors: DiscoveredSelector[] = [];
  const navigationSelectors: DiscoveredSelector[] = [];

  for (const el of (elementsInspect.items as Array<{ type: string; selector: string; text: string }> | undefined) ?? []) {
    const selector: DiscoveredSelector = {
      selector: el.selector,
      type: el.type === 'product' ? 'product' : 'list',
      confidence: 0.7,
      sampleText: el.text,
      pageUrls: [mainPage.url],
      timesUsed: 0,
      successRate: 0.5,
    };
    if (el.type === 'product') detailSelectors.push(selector);
    else listSelectors.push(selector);
  }

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

  let pagination: PaginationPattern | null = null;
  const pageLinks = (linksInspect.items as Array<{ text: string; href: string }> | undefined) ?? [];
  const pageLink = pageLinks.find((link) => /page|página|siguiente|next/i.test(link.text));
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

  const isJavaScriptHeavy = usedBrowser || stats.pagesOk === 0
    || pages.some((page) => page.links.length < 3 && page.htmlLength < 5000);

  if (!profile.id) throw new Error(`Perfil sin id para ${domain}`);
  await deps.repository.updateSelectors(profile.id, {
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

  const previous = await deps.repository.findFreshRadiography(mainPage.url, 24 * 3650).catch(() => null);
  const changed = Boolean(previous?.htmlHash && previous.htmlHash !== mainPage.htmlHash);
  if (changed) {
    console.warn(`[RADIOGRAPHY] cambio detectado en ${mainPage.url} (hash ${previous?.htmlHash} → ${mainPage.htmlHash})`);
  }

  const structure = {
    lists: (mainPage.elementCounts ?? []).map((entry) => ({ selector: entry.selector, count: entry.count, sampleItems: [] })),
    forms: [] as Array<{ selector: string; fields: string[] }>,
    scripts: 0,
    stylesheets: 0,
  };
  await deps.repository.saveRadiography({
    url: mainPage.url,
    profileId: profile.id,
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
