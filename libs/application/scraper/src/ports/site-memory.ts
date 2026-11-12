/** Perfil aprendido mínimo que consumen planner y runner. */
export interface LearnedSiteProfile {
  id?: string;
  domain: string;
  totalJobs: number;
  successfulJobs: number;
  avgItemsPerJob: number;
}

export interface LearnedSiteSnapshot {
  profile: LearnedSiteProfile | null;
  shouldUseBrowser: boolean;
  recommendedSelectors: {
    list: string[];
    detail?: string[];
    pagination?: unknown;
  };
}

/** Memoria de sitios (MongoDB en producción) como puerto propiedad del consumidor. */
export interface SiteMemory {
  getLearnedProfile(url: string): Promise<LearnedSiteSnapshot>;
  getOrCreateProfile(domain: string, url: string): Promise<{ id?: string }>;
  recordJobResult(profileId: string, success: boolean, itemCount: number, durationMs: number): Promise<void>;
}
