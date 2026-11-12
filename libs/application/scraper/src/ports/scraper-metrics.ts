/** Métricas del procesador de jobs; el adaptador decide dónde agregarlas. */
export interface ScraperMetrics {
  inc(name: string, by?: number): void;
}
