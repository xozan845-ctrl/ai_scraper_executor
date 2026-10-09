/**
 * Tipos de persistencia (§11, §40).
 * Fuente única: JobStatus/JobLimits/DEFAULT_LIMITS viven en @ai-scraper/domain-execution.
 * Aquí se re-exportan para compatibilidad (ETAPA 1: elimina duplicación).
 */
import { JobStatus as CoreStatus } from '@ai-scraper/domain-execution';
import type { JobLimits } from '@ai-scraper/domain-execution';

export { JobStatus as CoreStatus, DEFAULT_LIMITS } from '@ai-scraper/domain-execution';
export type { JobLimits } from '@ai-scraper/domain-execution';

/** Unión de strings derivada del enum core — acepta 'QUEUED' y JobStatus.QUEUED. */
export type JobStatus = `${CoreStatus}`;

export interface CreateJobInput {
  url: string;
  instruction: string;
  limits?: JobLimits;
  aiProvider?: string;
  aiModel?: string;
  /** Sesión (chat) de origen, si el job se creó desde /sessions. */
  sessionId?: string;
  /** Identidad opaca derivada de la API key; nunca contiene la clave en claro. */
  ownerScope?: string;
}

export interface JobRecord extends CreateJobInput {
  id: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ResultRow {
  id: string;
  data: unknown;
  sourceUrl?: string;
  selector?: string;
  confidence?: number;
  createdAt: string;
}

export interface CommandRow {
  id: string;
  type: string;
  payload: unknown;
  status: string;
  createdAt: string;
}

export interface PageRow {
  id: string;
  url: string;
  title?: string;
  depth: number;
  createdAt: string;
}

export interface ErrorRow {
  id: string;
  message: string;
  context?: unknown;
  createdAt: string;
}

export interface AIInteractionInput {
  provider: string;
  model?: string;
  kind: string;
  request?: unknown;
  response?: unknown;
  tokens?: number;
  latencyMs?: number;
}

export interface AIInteractionRow {
  id: string;
  provider: string;
  model?: string;
  kind: string;
  tokens?: number;
  latencyMs?: number;
  createdAt: string;
}

/** Agregados para dashboard (FASE 9) y /metrics (FASE 10, §56). */
export interface StoreStats {
  jobsTotal: number;
  jobsByStatus: Record<string, number>;
  resultsTotal: number;
  commandsTotal: number;
  /** Comandos con status RECOVERED — numerador del AI Recovery Rate §56. */
  commandsRecovered: number;
  pagesTotal: number;
  errorsTotal: number;
  aiCallsTotal: number;
  aiTokensTotal: number;
}
