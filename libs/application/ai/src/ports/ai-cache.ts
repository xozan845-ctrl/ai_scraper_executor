/**
 * Puerto de caché de respuestas IA. Lo consume `AIOrchestrator`; la
 * implementación concreta (Redis con fallback a memoria) vive en
 * `infrastructure/redis` (`R-HX-11`).
 */
export interface AICache {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlMs?: number): Promise<void>;
}
