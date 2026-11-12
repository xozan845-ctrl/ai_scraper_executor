import { JobStatus as CoreStatus } from '@ai-scraper/domain-execution';
import type { JobLimits } from '@ai-scraper/domain-execution';
import type { RenderOptions } from '@ai-scraper/domain-scraper';

export { JobStatus as CoreStatus, DEFAULT_LIMITS } from '@ai-scraper/domain-execution';
export type { JobLimits } from '@ai-scraper/domain-execution';

export type JobStatus = `${CoreStatus}`;

export interface CreateJobInput {
  url: string;
  instruction: string;
  limits?: JobLimits;
  aiProvider?: string;
  aiModel?: string;
  sessionId?: string;
  ownerScope?: string;
  /** URL externa notificada al terminar el job (validada contra SSRF). */
  webhookUrl?: string;
  /** Render con navegador para SPAs; `auto` usa la heurística del motor. */
  render?: RenderOptions;
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

export interface StoreStats {
  jobsTotal: number;
  jobsByStatus: Record<string, number>;
  resultsTotal: number;
  commandsTotal: number;
  commandsRecovered: number;
  pagesTotal: number;
  errorsTotal: number;
  aiCallsTotal: number;
  aiTokensTotal: number;
}

export interface SaveResultInput {
  data: unknown;
  sourceUrl?: string;
  selector?: string;
  confidence?: number;
}

export interface ListJobsOptions {
  cursor?: string;
  status?: string;
  ownerScope?: string;
}
