export interface JobLimits {
  maxPages?: number;
  maxDepth?: number;
  maxItems?: number;
  maxRuntimeSec?: number;
  maxRequests?: number;
  /** Presupuesto de tokens IA por job (0 = sin límite). Corta la ejecución al superarlo. */
  maxAiTokens?: number;
}

export const DEFAULT_LIMITS: Required<JobLimits> = {
  maxPages: 100,
  maxDepth: 5,
  maxItems: 10000,
  maxRuntimeSec: 300,
  maxRequests: 1000,
  maxAiTokens: 200000,
};

/**
 * Topes duros de servidor (§35): ninguna petición, ni la IA, puede superarlos.
 * Se aplican en la normalización, de modo que aunque el DTO se evite (llamadas
 * internas/tests), no se pueden agotar recursos ni coste LLM.
 */
export const HARD_LIMITS: Required<JobLimits> = {
  maxPages: 1000,
  maxDepth: 10,
  maxItems: 100000,
  maxRuntimeSec: 3600,
  maxRequests: 100000,
  maxAiTokens: 5_000_000,
};

/**
 * Normaliza los límites de un job a un rango seguro:
 * - valor no numérico, no finito o <= 0 (p. ej. `maxAiTokens: 0`) → DEFAULT_LIMITS;
 * - valor válido → entero dentro de [1, HARD_LIMITS[key]].
 * Con esto `0`/vacío NO desactiva el presupuesto de tokens: usa el del servidor.
 */
export function normalizeJobLimits(input?: JobLimits): Required<JobLimits> {
  const pick = (key: keyof Required<JobLimits>): number => {
    const raw = input?.[key];
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return DEFAULT_LIMITS[key];
    // `Math.max(1, …)`: un positivo < 1 (p. ej. 5e-324) hace floor 0; sin el tope
    // inferior se salía de [1, HARD] y rompía la idempotencia (hallado por R-PB).
    return Math.max(1, Math.min(Math.floor(raw), HARD_LIMITS[key]));
  };
  return {
    maxPages: pick('maxPages'),
    maxDepth: pick('maxDepth'),
    maxItems: pick('maxItems'),
    maxRuntimeSec: pick('maxRuntimeSec'),
    maxRequests: pick('maxRequests'),
    maxAiTokens: pick('maxAiTokens'),
  };
}
