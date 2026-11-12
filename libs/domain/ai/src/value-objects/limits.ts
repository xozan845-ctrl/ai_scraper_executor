/**
 * Recorte de límites por job (anti-escalada §35).
 * La IA nunca puede elevar maxPages/maxItems; se aplica a TODO comando,
 * incluidas las decisiones dinámicas de Fase B (analyzePage/recover).
 */

export interface JobLimitCaps {
  maxPages?: number;
  maxItems?: number;
}

function clampInt(value: unknown, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(Math.max(n, 1), max);
}

/** Aplica los topes del job a un comando (mutación in-place y devuelve el mismo objeto). */
export function clampCommandLimits<T>(cmd: T, caps: JobLimitCaps): T {
  const c = cmd as Record<string, unknown>;
  const maxPages = caps.maxPages ?? 100;
  const maxItems = caps.maxItems ?? 10000;
  const type = c.type as string | undefined;
  if (type === 'PAGINATE') {
    c.maxPages = clampInt(c.maxPages, maxPages, maxPages);
  } else if (type === 'FOLLOW_LINKS') {
    c.maxLinks = clampInt(c.maxLinks, maxPages, 10);
  } else if (type === 'EXTRACT_LIST' || type === 'EXTRACT_TABLE' || type === 'EXTRACT_STRUCTURED' || type === 'EXTRACT_NETWORK') {
    c.limit = clampInt(c.limit, maxItems, 100);
  } else if (type === 'EXTRACT_TEXT') {
    c.maxLength = clampInt(c.maxLength, 10000, 5000);
  } else if (type === 'SCROLL') {
    c.maxSteps = clampInt(c.maxSteps, 50, 1);
    c.settleMs = clampInt(c.settleMs, 5000, 1200);
  }
  return cmd;
}
