import { randomUUID } from 'crypto';
import type { JobStore, SaveResultInput } from './job-store';
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

const now = () => new Date().toISOString();
const nid = (p: string) => `${p}_${randomUUID().slice(0, 8)}`;

/** Store en memoria: tests y desarrollo sin PostgreSQL. Misma interfaz que Prisma. */
export class InMemoryJobStore implements JobStore {
  readonly kind = 'memory' as const;
  private jobs = new Map<string, JobRecord>();
  private order: string[] = [];
  private plans: Array<{ jobId: string; payload: unknown }> = [];
  private commands = new Map<string, CommandRow[]>();
  private pages = new Map<string, PageRow[]>();
  private results = new Map<string, ResultRow[]>();
  private errors = new Map<string, ErrorRow[]>();
  private interactions: Array<{ jobId: string } & AIInteractionInput> = [];

  async createJob(input: CreateJobInput): Promise<JobRecord> {
    const rec: JobRecord = {
      ...input,
      id: nid('job'),
      status: 'QUEUED',
      createdAt: now(),
      updatedAt: now(),
    };
    this.jobs.set(rec.id, rec);
    this.order.push(rec.id);
    return { ...rec };
  }

  async getJob(id: string): Promise<JobRecord | null> {
    return this.jobs.get(id) ?? null;
  }

  async listJobs(limit = 20): Promise<JobRecord[]> {
    return this.order
      .slice(-limit)
      .reverse()
      .map((id) => ({ ...(this.jobs.get(id) as JobRecord) }));
  }

  async updateStatus(id: string, status: JobStatus): Promise<JobRecord | null> {
    const job = this.jobs.get(id);
    if (!job) return null;
    job.status = status;
    job.updatedAt = now();
    return { ...job };
  }

  async savePlan(jobId: string, payload: unknown): Promise<void> {
    this.plans.push({ jobId, payload });
  }

  async saveCommand(jobId: string, type: string, payload: unknown, status: string): Promise<void> {
    const list = this.commands.get(jobId) ?? [];
    list.push({ id: nid('cmd'), type, payload, status, createdAt: now() });
    this.commands.set(jobId, list);
  }

  async savePage(jobId: string, url: string, title?: string, depth?: number): Promise<void> {
    const list = this.pages.get(jobId) ?? [];
    if (list.some((p) => p.url === url)) return;
    list.push({ id: nid('page'), url, title, depth: depth ?? 0, createdAt: now() });
    this.pages.set(jobId, list);
  }

  async saveResults(jobId: string, items: SaveResultInput[]): Promise<number> {
    const list = this.results.get(jobId) ?? [];
    for (const it of items) {
      list.push({ id: nid('res'), data: it.data, sourceUrl: it.sourceUrl, selector: it.selector, confidence: it.confidence, createdAt: now() });
    }
    this.results.set(jobId, list);
    return items.length;
  }

  async saveError(jobId: string, message: string, context?: unknown): Promise<void> {
    const list = this.errors.get(jobId) ?? [];
    list.push({ id: nid('err'), message, context, createdAt: now() });
    this.errors.set(jobId, list);
  }

  async saveAIInteraction(jobId: string, input: AIInteractionInput): Promise<void> {
    this.interactions.push({ jobId, ...input });
  }

  async getResults(jobId: string): Promise<ResultRow[]> {
    return [...(this.results.get(jobId) ?? [])];
  }

  async getCommands(jobId: string): Promise<CommandRow[]> {
    return [...(this.commands.get(jobId) ?? [])];
  }

  async getPages(jobId: string): Promise<PageRow[]> {
    return [...(this.pages.get(jobId) ?? [])];
  }

  async getErrors(jobId: string): Promise<ErrorRow[]> {
    return [...(this.errors.get(jobId) ?? [])];
  }

  async getAIInteractions(jobId: string): Promise<AIInteractionRow[]> {
    return this.interactions
      .filter((i) => i.jobId === jobId)
      .map((i, n) => ({
        id: `ai_${n}`,
        provider: i.provider,
        model: i.model,
        kind: i.kind,
        tokens: i.tokens,
        latencyMs: i.latencyMs,
        createdAt: now(),
      }));
  }

  async getStats(): Promise<StoreStats> {
    const jobsByStatus: Record<string, number> = {};
    for (const j of this.jobs.values()) jobsByStatus[j.status] = (jobsByStatus[j.status] ?? 0) + 1;
    const sum = (m: Map<string, Array<unknown>>) => [...m.values()].reduce((a, l) => a + l.length, 0);
    const recovered = [...this.commands.values()]
      .flat()
      .filter((c) => c.status === 'RECOVERED').length;
    return {
      jobsTotal: this.jobs.size,
      jobsByStatus,
      resultsTotal: sum(this.results),
      commandsTotal: sum(this.commands),
      commandsRecovered: recovered,
      pagesTotal: sum(this.pages),
      errorsTotal: sum(this.errors),
      aiCallsTotal: this.interactions.length,
      aiTokensTotal: this.interactions.reduce((a, i) => a + (i.tokens ?? 0), 0),
    };
  }
}
