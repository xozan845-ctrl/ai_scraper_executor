/**
 * @ai-scraper/core — tipos compartidos (§41, §35, §42)
 * Principio: la IA decide QUÉ, el motor decide CÓMO (§4).
 */

export enum JobStatus {
  CREATED = 'CREATED',
  QUEUED = 'QUEUED',
  PLANNING = 'PLANNING',
  EXPLORING = 'EXPLORING',
  EXECUTING = 'EXECUTING',
  RECOVERING = 'RECOVERING',
  INTERPRETING = 'INTERPRETING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  TIMEOUT = 'TIMEOUT',
}

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

export interface CreateJobInput {
  url: string;
  instruction: string;
  limits?: JobLimits;
  ai?: {
    provider?: 'openrouter' | 'custom';
    model?: string;
  };
}

export interface JobRecord extends CreateJobInput {
  id: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TracedValue<T = unknown> {
  value: T;
  source: {
    url: string;
    selector?: string;
    scrapedAt: string;
    confidence?: number;
  };
}

export interface StructuredItem {
  [key: string]: TracedValue | unknown;
}
