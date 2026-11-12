export interface RadiographyOptions {
  maxDepth?: number;
  maxPages?: number;
  forceBrowser?: boolean;
  headers?: Record<string, string>;
}

export interface RadiographyRunResult {
  profile: { id?: string };
  discovered?: unknown;
  radiography: unknown;
}

export interface LearnedProfileSnapshot {
  profile: unknown | null;
  shouldUseBrowser: boolean;
  recommendedSelectors: unknown;
}

/** Acceso a la memoria de sitios (MongoDB en producción). */
export interface SiteKnowledge {
  perform(url: string, options?: RadiographyOptions): Promise<RadiographyRunResult>;
  findProfile(domain: string): Promise<unknown | null>;
  getLearnedProfile(url: string): Promise<LearnedProfileSnapshot>;
  findFreshRadiography(target: string, maxAgeHours: number): Promise<unknown | null>;
  getDomainStats(domain: string): Promise<unknown>;
}
