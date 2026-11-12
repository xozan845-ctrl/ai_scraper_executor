import { mongoRepo, normalizeDomain } from './repository';
import type { DiscoveredSelector, ISiteProfile, PaginationPattern } from './models';

/** Obtiene el perfil aprendido para usar en scraping posterior. */
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

  const list = profile.listSelectors
    .filter((selector: DiscoveredSelector) => selector.confidence > 0.5)
    .sort((a: DiscoveredSelector, b: DiscoveredSelector) => b.confidence - a.confidence || b.timesUsed - a.timesUsed)
    .map((selector: DiscoveredSelector) => selector.selector);

  const detail = profile.detailSelectors
    .filter((selector: DiscoveredSelector) => selector.confidence > 0.5)
    .sort((a: DiscoveredSelector, b: DiscoveredSelector) => b.confidence - a.confidence || b.timesUsed - a.timesUsed)
    .map((selector: DiscoveredSelector) => selector.selector);

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
