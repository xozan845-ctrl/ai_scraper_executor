import type {
  JobStatus,
  JobRecord,
  CreateJobInput,
  ResultRow,
  CommandRow,
  PageRow,
  ErrorRow,
  AIInteractionInput,
  AIInteractionRow,
  StoreStats,
} from './types';

export interface SaveResultInput {
  data: unknown;
  sourceUrl?: string;
  selector?: string;
  confidence?: number;
}

/**
 * JobStore — persistencia de jobs y artefactos (§11, §40).
 * Implementaciones: PrismaJobStore (PostgreSQL) e InMemoryJobStore (tests/dev sin DB).
 */
export interface JobStore {
  readonly kind: 'prisma' | 'memory';
  createJob(input: CreateJobInput): Promise<JobRecord>;
  getJob(id: string): Promise<JobRecord | null>;
  listJobs(limit?: number): Promise<JobRecord[]>;
  updateStatus(id: string, status: JobStatus): Promise<JobRecord | null>;
  savePlan(jobId: string, payload: unknown): Promise<void>;
  saveCommand(jobId: string, type: string, payload: unknown, status: string): Promise<void>;
  savePage(jobId: string, url: string, title?: string, depth?: number): Promise<void>;
  saveResults(jobId: string, items: SaveResultInput[]): Promise<number>;
  saveError(jobId: string, message: string, context?: unknown): Promise<void>;
  saveAIInteraction(jobId: string, input: AIInteractionInput): Promise<void>;
  getResults(jobId: string): Promise<ResultRow[]>;
  getCommands(jobId: string): Promise<CommandRow[]>;
  getPages(jobId: string): Promise<PageRow[]>;
  getErrors(jobId: string): Promise<ErrorRow[]>;
  getAIInteractions(jobId: string): Promise<AIInteractionRow[]>;
  /** Agregados globales para dashboard y /metrics. */
  getStats(): Promise<StoreStats>;
}
