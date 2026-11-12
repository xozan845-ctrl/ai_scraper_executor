import { normalizeDomain } from '@ai-scraper/shared-security';
import type { SiteKnowledge } from '../../ports/site-knowledge';

export class SiteProfileNotFoundError extends Error {
  constructor(domain: string) {
    super(`Perfil no encontrado para ${domain}`);
    this.name = 'SiteProfileNotFoundError';
  }
}

export class SiteRadiographyNotFoundError extends Error {
  constructor(target: string) {
    super(`Radiografía no encontrada o expirada para ${target}`);
    this.name = 'SiteRadiographyNotFoundError';
  }
}

export interface RadiographyCreateInput {
  url: string;
  maxDepth?: number;
  maxPages?: number;
  forceBrowser?: boolean;
}

export interface SiteRadiographyUseCaseDeps {
  knowledge: SiteKnowledge;
}

/** Radiografía y memoria de sitios: coordina el puerto, sin conocer Mongo. */
export class SiteRadiographyUseCases {
  constructor(private readonly deps: SiteRadiographyUseCaseDeps) {}

  async create(input: RadiographyCreateInput) {
    const result = await this.deps.knowledge.perform(input.url, {
      maxDepth: input.maxDepth,
      maxPages: input.maxPages,
      forceBrowser: input.forceBrowser,
    });
    return {
      domain: normalizeDomain(input.url, { stripWww: true }),
      profileId: result.profile.id,
      discovered: result.discovered,
      radiography: result.radiography,
    };
  }

  async getProfile(domain: string) {
    const profile = await this.deps.knowledge.findProfile(domain);
    if (!profile) throw new SiteProfileNotFoundError(domain);
    return profile;
  }

  getSelectors(domain: string) {
    return this.deps.knowledge.getLearnedProfile(`https://${domain}`);
  }

  async getPageRadiography(target: string, maxAgeHours = 24) {
    const radiography = await this.deps.knowledge.findFreshRadiography(target, maxAgeHours);
    if (!radiography) throw new SiteRadiographyNotFoundError(target);
    return radiography;
  }

  getDomainStats(domain: string) {
    return this.deps.knowledge.getDomainStats(domain);
  }
}

export function createSiteRadiographyUseCases(deps: SiteRadiographyUseCaseDeps): SiteRadiographyUseCases {
  return new SiteRadiographyUseCases(deps);
}
