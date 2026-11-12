import {
  performRadiography,
  type RadiographyDeps,
  type RadiographyOptions,
  type RadiographyResult,
} from '@ai-scraper/application-scraper';
import { CrawlerService } from '@ai-scraper/infrastructure-crawler';
import { ExecutionEngine } from '@ai-scraper/infrastructure-execution';
import { mongoRepo } from '@ai-scraper/infrastructure-mongodb';

/** Composition root de la radiografía: crawler + motor + repositorio Mongo. */
export function createRadiographyDeps(): RadiographyDeps {
  const crawler = new CrawlerService();
  return {
    crawler: {
      crawlDetailed: (input) => crawler.crawlDetailed(input),
    },
    engine: new ExecutionEngine(),
    repository: {
      getOrCreateProfile: (domain, url) => mongoRepo.getOrCreateProfile(domain, url),
      updateSelectors: async (profileId, update) => {
        await mongoRepo.updateSelectors(profileId, update as Parameters<typeof mongoRepo.updateSelectors>[1]);
      },
      findFreshRadiography: (url, maxAgeHours) => mongoRepo.findFreshRadiography(url, maxAgeHours),
      saveRadiography: async (input) => {
        await mongoRepo.saveRadiography(input as Parameters<typeof mongoRepo.saveRadiography>[0]);
      },
    },
  };
}

export function runRadiography(url: string, options?: RadiographyOptions): Promise<RadiographyResult> {
  return performRadiography(url, options, createRadiographyDeps());
}
