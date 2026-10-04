/**
 * Log estructurado §38-39. Una línea JSON por evento (fácil de agregar
 * con Loki/ELK; LOG_LEVEL filtra por severidad).
 */
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

/** Instancia emisora (ETAPA 5): correlación multi-réplica en Loki/ELK. */
function instance(): string {
  const fixed = (process.env.INSTANCE_ID ?? '').trim();
  if (fixed) return fixed;
  return `pid-${process.pid}`;
}

function emit(level: LogLevel, msg: string, fields: LogFields = {}): void {
  if (ORDER[level] < ORDER[activeLevel()]) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, instance: instance(), ...fields });
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
