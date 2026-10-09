/**
 * Log estructurado §38-39. Una línea JSON por evento (fácil de agregar
 * con Loki/ELK; LOG_LEVEL filtra por severidad).
 * Contexto de correlación (correlationId/jobId) vía AsyncLocalStorage, para
 * seguir un job a través de API → cola → worker sin pasarlo a mano.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function activeLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw;
  return 'info';
}

export interface LogFields {
  jobId?: string;
  provider?: string;
  [key: string]: unknown;
}

export interface LogContext {
  correlationId?: string;
  jobId?: string;
}

const als = new AsyncLocalStorage<LogContext>();

/** Ejecuta `fn` con un contexto de correlación; los logs dentro lo incluyen automáticamente. */
export function runWithContext<T>(ctx: LogContext, fn: () => T): T {
  return als.run({ ...ctx }, fn);
}

/** Contexto actual (correlationId/jobId) o {} si no hay. */
export function getContext(): LogContext {
  return als.getStore() ?? {};
}

/** Añade campos al contexto actual (p. ej. jobId dentro del worker). */
export function updateContext(patch: LogContext): void {
  const store = als.getStore();
  if (store) Object.assign(store, patch);
}

/** Instancia emisora (ETAPA 5): correlación multi-réplica en Loki/ELK. */
function instance(): string {
  const fixed = (process.env.INSTANCE_ID ?? '').trim();
  if (fixed) return fixed;
  return `pid-${process.pid}`;
}

function emit(level: LogLevel, msg: string, fields: LogFields = {}): void {
  if (ORDER[level] < ORDER[activeLevel()]) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    instance: instance(),
    ...getContext(),
    ...fields,
  });
  if (level === 'error') console.error(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, fields?: LogFields) => emit('debug', msg, fields),
  info: (msg: string, fields?: LogFields) => emit('info', msg, fields),
  warn: (msg: string, fields?: LogFields) => emit('warn', msg, fields),
  error: (msg: string, fields?: LogFields) => emit('error', msg, fields),
};

/** Compat FASE 0: `log(jobId, ...args)` ahora emite JSON vía `info`. */
export function log(jobId: string, ...args: unknown[]) {
  emit('info', args.map((a) => String(a)).join(' '), { jobId });
}

/**
 * Tracing-lite: mide la duración de un bloque y lo emite como span estructurado
 * (con correlationId/jobId del contexto). Compatible con agregadores OTLP/Loki.
 */
export async function withSpan<T>(name: string, fn: () => Promise<T>, attrs: LogFields = {}): Promise<T> {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    emit('debug', `span:${name}`, { ...attrs, span: name, durationMs: Date.now() - start });
  }
}
