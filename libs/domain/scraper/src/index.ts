/**
 * @ai-scraper/domain-scraper — bounded context de scraping.
 * Value objects de la **trazabilidad** de cada item extraído (§33). Dominio puro:
 * sin frameworks, sin I/O y sin dependencias de infraestructura (`R-HX-3`).
 */

export interface TracedValue<T = unknown> {
  value: T;
  source: {
    url: string;
    selector?: string;
    scrapedAt: string;
    confidence?: number;
  };
}

export interface StructuredItem {
  [key: string]: TracedValue | unknown;
}
