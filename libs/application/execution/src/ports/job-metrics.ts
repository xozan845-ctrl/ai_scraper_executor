/** Contador de métricas de aplicación; el adaptador concreto vive en el borde. */
export interface JobMetrics {
  inc(name: string): void;
}
