export interface RadiographyPage {
  url: string;
  htmlHash: string;
  title: string;
  statusCode?: number;
  elementCounts?: Array<{ selector: string; count: number }>;
  links: Array<{ href: string }>;
  htmlLength: number;
}

export interface RadiographyCrawlResult {
  pages: RadiographyPage[];
  stats: {
    usedBrowser: boolean;
    pagesOk: number;
    durationMs: number;
  };
}

export interface RadiographyCrawler {
  crawlDetailed(input: {
    url: string;
    mode: 'browser' | 'hybrid';
    maxDepth: number;
    maxRequests: number;
    maxConcurrency: number;
    headers?: Record<string, string>;
  }): Promise<RadiographyCrawlResult>;
}

export interface RadiographyEngine {
  execute(command: { type: 'NAVIGATE'; url: string } | { type: 'INSPECT_PAGE' } | { type: 'INSPECT_LINKS' } | { type: 'INSPECT_ELEMENTS' }): Promise<{ items?: unknown[] }>;
}

export interface RadiographyAdapters {
  createCrawler(): RadiographyCrawler;
  createEngine(): RadiographyEngine;
}
