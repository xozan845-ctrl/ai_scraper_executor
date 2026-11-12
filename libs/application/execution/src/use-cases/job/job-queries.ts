import type { AIInteractionRow, CommandRow, ErrorRow, JobRecord, ListJobsOptions, PageRow, ResultRow } from '../../dtos/job';
import type { JobStore } from '../../ports/job-store';
import { toJobView, type JobView } from './job-view';

export interface JobResultsView {
  jobId: string;
  status: string;
  count: number;
  items: unknown[];
}

export interface JobExecutionView {
  jobId: string;
  status: string;
  commands: CommandRow[];
  pages: PageRow[];
  errors: ErrorRow[];
}

export interface JobAIInteractionsView {
  jobId: string;
  provider?: string;
  model?: string;
  count: number;
  calls: AIInteractionRow[];
}

export interface JobListView {
  items: JobView[];
  nextCursor: string | null;
}

/** Consultas de solo lectura sobre jobs, con ownership por ámbito. */
export class JobQueries {
  constructor(private readonly store: JobStore) {}

  private async ownedJob(id: string, scope: string): Promise<JobRecord | null> {
    const job = await this.store.getJob(id);
    return job?.ownerScope === scope ? job : null;
  }

  async findOne(id: string, scope = 'anon'): Promise<JobView | null> {
    const job = await this.ownedJob(id, scope);
    return job ? toJobView(job) : null;
  }

  async list(
    limit?: number,
    options?: Omit<ListJobsOptions, 'ownerScope'>,
    scope = 'anon',
  ): Promise<JobListView> {
    const size = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const rows = await this.store.listJobs(size + 1, { ...options, ownerScope: scope });
    const hasMore = rows.length > size;
    const items = (hasMore ? rows.slice(0, size) : rows).map((job) => toJobView(job));
    return {
      items,
      nextCursor: hasMore ? items[items.length - 1]!.id : null,
    };
  }

  async results(id: string, scope = 'anon'): Promise<JobResultsView | null> {
    const job = await this.ownedJob(id, scope);
    if (!job) return null;
    const rows = await this.store.getResults(id);
    return {
      jobId: id,
      status: job.status,
      count: rows.length,
      items: rows.map((row) => this.resultItem(row)),
    };
  }

  async execution(id: string, scope = 'anon'): Promise<JobExecutionView | null> {
    const job = await this.ownedJob(id, scope);
    if (!job) return null;
    const [commands, pages, errors] = await Promise.all([
      this.store.getCommands(id),
      this.store.getPages(id),
      this.store.getErrors(id),
    ]);
    return { jobId: id, status: job.status, commands, pages, errors };
  }

  async aiInteractions(id: string, limit = 50, scope = 'anon'): Promise<JobAIInteractionsView | null> {
    const job = await this.ownedJob(id, scope);
    if (!job) return null;
    const size = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const calls = (await this.store.getAIInteractions(id)).slice(-size);
    return {
      jobId: id,
      provider: job.aiProvider,
      model: job.aiModel,
      count: calls.length,
      calls,
    };
  }

  private resultItem(row: ResultRow): unknown {
    if (row.data && typeof row.data === 'object' && !Array.isArray(row.data)) {
      const data = row.data as Record<string, unknown>;
      const existingSource = data._source && typeof data._source === 'object' && !Array.isArray(data._source)
        ? data._source as Record<string, unknown>
        : {};
      if (row.sourceUrl) {
        return {
          ...data,
          _source: {
            ...existingSource,
            url: row.sourceUrl,
            selector: row.selector ?? existingSource.selector,
          },
        };
      }
      return data;
    }
    return row.data;
  }
}
