/**
 * Reintento acotado de fetch (D, bloque 1): reintenta SOLO errores transitorios
 * (red y 5xx/429) con backoff exponencial + jitter. Nunca reintenta 4xx.
 */
import { HttpError } from '@ai-scraper/shared-security';

const RETRYABLE_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN']);

/** ¿Merece la pena reintentar este error? 5xx/429 (HttpError) o fallos de red. */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof HttpError) return error.status >= 500 || error.status === 429;
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (typeof code === 'string' && RETRYABLE_CODES.has(code)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /socket hang up|Timeout HTTP|EAI_AGAIN/i.test(message);
}

export interface RetryOptions {
  maxRetries?: number;
  baseMs?: number;
  capMs?: number;
  maxRetryAfterMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

/**
 * Ejecuta `fetcher` reintentando errores transitorios. Los 4xx (salvo 429) se
 * propagan sin reintentar: reintentar una página inexistente no la arregla.
 */
export async function fetchWithRetry<T>(fetcher: () => Promise<T>, opts?: RetryOptions): Promise<T> {
  const maxRetries = opts?.maxRetries ?? 2;
  const baseMs = opts?.baseMs ?? 300;
  const capMs = opts?.capMs ?? 2000;
  const maxRetryAfterMs = opts?.maxRetryAfterMs ?? 5000;
  const sleep = opts?.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = opts?.random ?? Math.random;
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fetcher();
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries || !isRetryableError(error)) throw error;
      const retryAfterMs = error instanceof HttpError ? error.retryAfterMs : undefined;
      const delayMs =
        retryAfterMs !== undefined
          ? Math.min(retryAfterMs, maxRetryAfterMs)
          : Math.min(capMs, baseMs * 2 ** attempt) + Math.floor(random() * baseMs);
      opts?.onRetry?.({ attempt: attempt + 1, delayMs, error });
      await sleep(delayMs);
    }
  }
  throw lastError;
}
