import { getLearnedProfile, mongoRepo } from '@ai-scraper/infrastructure-mongodb';
import type { SiteMemory } from '@ai-scraper/application-scraper';

/** Adaptador de la memoria de sitios (MongoDB) para el workflow de scraping. */
export const siteMemory: SiteMemory = {
  async getLearnedProfile(url) {
    const learned = await getLearnedProfile(url);
    return {
      profile: learned.profile
        ? {
            id: learned.profile.id,
            domain: learned.profile.domain,
            totalJobs: learned.profile.totalJobs,
            successfulJobs: learned.profile.successfulJobs,
            avgItemsPerJob: learned.profile.avgItemsPerJob,
          }
        : null,
      shouldUseBrowser: learned.shouldUseBrowser,
      recommendedSelectors: {
        list: learned.recommendedSelectors.list,
        detail: learned.recommendedSelectors.detail,
        pagination: learned.recommendedSelectors.pagination,
      },
    };
  },

  async getOrCreateProfile(domain, url) {
    const profile = await mongoRepo.getOrCreateProfile(domain, url);
    return { id: profile.id };
  },

  recordJobResult(profileId, success, itemCount, durationMs) {
    return mongoRepo.recordJobResult(profileId, success, itemCount, durationMs);
  },

  async recordSelectorResult(domain, selector, success, itemCount) {
    if (!success || itemCount <= 0) return;
    const profile = await mongoRepo.getOrCreateProfile(domain, `https://${domain}`);
    if (!profile.id) return;
    await mongoRepo.updateSelectors(profile.id, {
      listSelectors: [{
        selector,
        type: 'list',
        confidence: 0.6,
        pageUrls: [`https://${domain}`],
        timesUsed: 1,
        successRate: 0.5,
      }],
    });
  },
};
