export interface ScrapingJobPayload {
  jobId: string;
  url: string;
  instruction: string;
  limits?: Record<string, number>;
  ai?: { provider?: string; model?: string };
  /**
   * Prioridad FASE 11 (ETAPA 6): 1 = máxima, 10 = mínima, 5 = defecto.
   * BullMQ ordena ascendente; la cola en memoria replica el orden.
   */
  priority?: number;
}

/** Normaliza a 1..10; defecto 5. */
export function normalizePriority(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 5;
  return Math.min(10, Math.max(1, Math.round(n)));
}
