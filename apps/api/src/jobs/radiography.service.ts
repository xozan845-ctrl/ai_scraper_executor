import { Injectable, NotFoundException } from '@nestjs/common';
import {
  createSiteRadiographyUseCases,
  SiteProfileNotFoundError,
  SiteRadiographyNotFoundError,
  type SiteKnowledge,
  type SiteRadiographyUseCases,
} from '@ai-scraper/application-execution';

export interface RadiographyCreateInput {
  url: string;
  maxDepth?: number;
  maxPages?: number;
  forceBrowser?: boolean;
}

/**
 * Radiografía y memoria de sitios (FASE 12). Adaptador Nest del caso de uso;
 * el acceso a Mongo se inyecta como puerto `SiteKnowledge` (`R-HX-10`).
 */
@Injectable()
export class RadiographyService {
  private readonly useCases: SiteRadiographyUseCases;

  constructor() {
    const knowledge: SiteKnowledge = {
      perform: async (url, options) => {
        const { runRadiography } = await import('./radiography-adapter');
        return runRadiography(url, options);
      },
      findProfile: async (domain) => {
        const { mongoRepo } = await import('@ai-scraper/infrastructure-mongodb');
        return mongoRepo.findProfile(domain);
      },
      getLearnedProfile: async (url) => {
        const { getLearnedProfile } = await import('@ai-scraper/infrastructure-mongodb');
        return getLearnedProfile(url);
      },
      findFreshRadiography: async (target, maxAgeHours) => {
        const { mongoRepo } = await import('@ai-scraper/infrastructure-mongodb');
        return mongoRepo.findFreshRadiography(target, maxAgeHours);
      },
      getDomainStats: async (domain) => {
        const { mongoRepo } = await import('@ai-scraper/infrastructure-mongodb');
        return mongoRepo.getDomainStats(domain);
      },
    };
    this.useCases = createSiteRadiographyUseCases({ knowledge });
  }

  async create(input: RadiographyCreateInput) {
    return this.useCases.create(input);
  }

  async getProfile(domain: string) {
    try {
      return await this.useCases.getProfile(domain);
    } catch (error) {
      throw this.toHttpError(error);
    }
  }

  getSelectors(domain: string) {
    return this.useCases.getSelectors(domain);
  }

  async getPageRadiography(target: string, maxAgeHours: number) {
    try {
      return await this.useCases.getPageRadiography(target, maxAgeHours);
    } catch (error) {
      throw this.toHttpError(error);
    }
  }

  getDomainStats(domain: string) {
    return this.useCases.getDomainStats(domain);
  }

  private toHttpError(error: unknown): unknown {
    if (error instanceof SiteProfileNotFoundError || error instanceof SiteRadiographyNotFoundError) {
      return new NotFoundException(error.message);
    }
    return error;
  }
}
