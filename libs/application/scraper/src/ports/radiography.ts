import type { DiscoveredSelector, PaginationPattern } from '@ai-scraper/domain-scraper';

export interface RadiographyOptions {
  maxDepth?: number;
  maxPages?: number;
  forceBrowser?: boolean;
  headers?: Record<string, string>;
}

export interface CrawlPageSummary {
  url: string;
  title: string;
  htmlHash: string;
  htmlLength: number;
  statusCode?: number;
  elementCounts?: Array<{ selector: string; count: number }>;
  links: Array<{ text: string; href: string }>;
}

export interface CrawlStatsSummary {
  usedBrowser: boolean;
  durationMs: number;
  pagesOk: number;
}

export interface CrawlInput {
  url: string;
  mode: 'browser' | 'hybrid';
  maxDepth: number;
  maxRequests: number;
  maxConcurrency: number;
  headers?: Record<string, string>;
}

/** Puerto del crawler para la radiografía; el adaptador es infrastructure/crawler. */
export interface SiteCrawler {
  crawlDetailed(input: CrawlInput): Promise<{ pages: CrawlPageSummary[]; stats: CrawlStatsSummary }>;
}

export interface RadiographyProfile {
  id?: string;
  domain?: string;
  totalJobs?: number;
  successfulJobs?: number;
  avgItemsPerJob?: number;
}

/** Persistencia de perfiles/radiografías; el adaptador es infrastructure/mongodb. */
export interface RadiographyProfileRepository {
  getOrCreateProfile(domain: string, url: string): Promise<RadiographyProfile>;
  updateSelectors(profileId: string, update: Record<string, unknown>): Promise<void>;
  findFreshRadiography(url: string, maxAgeHours: number): Promise<{ htmlHash?: string } | null>;
  saveRadiography(input: Record<string, unknown>): Promise<void>;
}

export interface RadiographyResult {
  profile: RadiographyProfile;
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
