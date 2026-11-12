/** Selector descubierto con metadata de confianza y uso (memoria de sitios). */
export interface DiscoveredSelector {
  selector: string;
  type: 'product' | 'list' | 'pagination' | 'detail' | 'navigation' | 'other';
  confidence: number;
  sampleText?: string;
  attributes?: string[];
  pageUrls: string[];
  timesUsed: number;
  lastUsedAt?: Date;
  successRate: number;
}

/** Patrón de paginación detectado. */
export interface PaginationPattern {
  type: 'query' | 'path' | 'next-link' | 'infinite-scroll';
  pattern?: string;
  selector?: string;
  maxPagesDetected?: number;
  confidence: number;
}
