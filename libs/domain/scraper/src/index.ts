/**
 * @ai-scraper/domain-scraper — bounded context de scraping.
 * Value objects de la **trazabilidad** de cada item extraído (§33). Dominio puro:
 * sin frameworks, sin I/O y sin dependencias de infraestructura (`R-HX-3`).
 */

export * from './entities/engine-memory';
export * from './services/dedupe';
export * from './value-objects/site-structure';
export * from './value-objects/traced-value';
