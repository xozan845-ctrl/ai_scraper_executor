import { Injectable, NotFoundException } from '@nestjs/common';
import { mongoRepo, normalizeDomain, performRadiography, getLearnedProfile } from '@ai-scraper/infrastructure-mongodb';

export interface RadiographyCreateInput {
  url: string;
  maxDepth?: number;
  maxPages?: number;
  forceBrowser?: boolean;
}

/**
 * Radiografía y memoria de sitios (FASE 12). Encapsula el acceso a la memoria
 * (Mongo) para que el controller solo orqueste HTTP — SRP, R-HX-2.
 */
@Injectable()
export class RadiographyService {
  async create(input: RadiographyCreateInput) {
    const result = await performRadiography(input.url, {
      maxDepth: input.maxDepth,
      maxPages: input.maxPages,
      forceBrowser: input.forceBrowser,
    });
    return {
      domain: normalizeDomain(input.url),
      profileId: result.profile.id,
      discovered: result.discovered,
      radiography: result.radiography,
    };
  }

  async getProfile(domain: string) {
    const profile = await mongoRepo.findProfile(domain);
    if (!profile) throw new NotFoundException(`Perfil no encontrado para ${domain}`);
    return profile;
  }

  getSelectors(domain: string) {
    return getLearnedProfile(`https://${domain}`);
  }

  async getPageRadiography(target: string, maxAgeHours: number) {
    const radiography = await mongoRepo.findFreshRadiography(target, maxAgeHours);
    if (!radiography) throw new NotFoundException(`Radiografía no encontrada o expirada para ${target}`);
    return radiography;
  }

  getDomainStats(domain: string) {
    return mongoRepo.getDomainStats(domain);
  }
}
