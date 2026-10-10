import type {
  AIInteractionInput,
  AIInteractionRow,
  CommandRow,
  CreateJobInput,
  ErrorRow,
  JobRecord,
  JobStatus,
  ListJobsOptions,
  PageRow,
  ResultRow,
  SaveResultInput,
  StoreStats,
} from '../dtos/job';

export interface JobStore {
  readonly kind: 'prisma' | 'memory';
  createJob(input: CreateJobInput): Promise<JobRecord>;
  getOrCreateJob(input: CreateJobInput, idempotencyKey: string): Promise<{ record: JobRecord; created: boolean }>;
  getJob(id: string): Promise<JobRecord | null>;
  listJobs(limit?: number, opts?: ListJobsOptions): Promise<JobRecord[]>;
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
  clearJobArtifacts(jobId: string): Promise<void>;
  getStats(): Promise<StoreStats>;
}
