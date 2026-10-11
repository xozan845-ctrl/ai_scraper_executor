import { createHash } from 'node:crypto';
import type { JobQueue } from '../ports/job-queue';
import type { JobStore } from '../ports/job-store';
import type { JobLimits, JobRecord } from '../dtos/job';

export interface CreateJobCommand {
  url: string;
  instruction: string;
  limits?: JobLimits;
  ai?: { provider?: string; model?: string };
  priority?: number;
}

export interface JobUseCaseOptions {
  correlationId?: () => string | undefined;
  incrementMetric?: (name: string, value?: number) => void;
  getDistributedCounters?: () => Promise<Record<string, number>>;
  processStats?: () => { instance: string; uptimeSec: number; process: unknown };
}

export class JobUseCases {
  constructor(
    private readonly store: JobStore,
    private readonly queue: JobQueue,
    private readonly options: JobUseCaseOptions = {},
  ) {}

  private publicJob<T extends { ownerScope?: string }>(record: T): Omit<T, 'ownerScope'> {
    const { ownerScope: _ownerScope, ...publicRecord } = record;
    return publicRecord;
  }

  private async ownedJob(id: string, scope: string): Promise<JobRecord | null> {
    const job = await this.store.getJob(id);
    return job?.ownerScope === scope ? job : null;
  }

  async create(command: CreateJobCommand, idempotencyKey?: string, sessionId?: string, scope = 'anon') {
    const scopedKey = idempotencyKey
      ? createHash('sha256').update(`${scope}\0${idempotencyKey}`).digest('hex')
      : null;
    const input = {
      url: command.url,
      instruction: command.instruction,
      limits: command.limits,
      aiProvider: command.ai?.provider ?? 'openrouter',
      aiModel: command.ai?.model,
      sessionId,
      ownerScope: scope,
    };
    const created = scopedKey
      ? await this.store.getOrCreateJob(input, scopedKey)
      : { record: await this.store.createJob(input), created: true };
    const record = created.record;
    if (!created.created) return this.publicJob(record);
    const correlationId = this.options.correlationId?.();
    try {
      await this.queue.enqueue({
        jobId: record.id,
        url: record.url,
        instruction: record.instruction,
        limits: (record.limits as Record<string, number>) ?? undefined,
        ai: { provider: record.aiProvider, model: record.aiModel },
        ...(command.priority !== undefined ? { priority: command.priority } : {}),
        ...(correlationId ? { correlationId } : {}),
      });
    } catch (error) {
      const message = (error as Error).message;
      await this.store.saveError(record.id, `Enqueue fallido: ${message}`);
      await this.store.updateStatus(record.id, 'FAILED');
      throw new Error(`Job creado pero no encolado: ${message}`, { cause: error });
    }
    this.options.incrementMetric?.('jobs_created_total');
    return this.publicJob(record);
  }

  async findOne(id: string, scope = 'anon') {
    const job = await this.ownedJob(id, scope);
    return job ? this.publicJob(job) : null;
  }

  async list(limit?: number, opts?: { cursor?: string; status?: string }, scope = 'anon') {
    const size = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const rows = await this.store.listJobs(size + 1, { ...opts, ownerScope: scope });
    const hasMore = rows.length > size;
    const items = (hasMore ? rows.slice(0, size) : rows).map((job) => this.publicJob(job));
    return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
  }

  async results(id: string, scope = 'anon') {
    const job = await this.ownedJob(id, scope);
    if (!job) return null;
    const rows = await this.store.getResults(id);
    return {
      jobId: id,
      status: job.status,
      count: rows.length,
      items: rows.map((row) => {
        if (row.data && typeof row.data === 'object' && !Array.isArray(row.data)) {
          const data = row.data as Record<string, unknown>;
          const existingSource = data._source && typeof data._source === 'object' && !Array.isArray(data._source)
            ? data._source as Record<string, unknown>
            : {};
          return {
            ...data,
            ...(row.sourceUrl ? { _source: { ...existingSource, url: row.sourceUrl, selector: row.selector ?? existingSource.selector } } : {}),
          };
        }
        return row.data;
      }),
    };
  }

  async execution(id: string, scope = 'anon') {
    const job = await this.ownedJob(id, scope);
    if (!job) return null;
    const [commands, pages, errors] = await Promise.all([
      this.store.getCommands(id), this.store.getPages(id), this.store.getErrors(id),
    ]);
    return { jobId: id, status: job.status, commands, pages, errors };
  }

  async cancel(id: string, scope = 'anon') {
    const job = await this.ownedJob(id, scope);
    if (!job) return null;
    if (['COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT'].includes(job.status)) return this.publicJob(job);
    await this.queue.remove(id).catch(() => false);
    this.options.incrementMetric?.('jobs_cancelled_total');
    const updated = await this.store.updateStatus(id, 'CANCELLED');
    return updated ? this.publicJob(updated) : null;
  }

  async retry(id: string, scope = 'anon') {
    const job = await this.ownedJob(id, scope);
    if (!job) return null;
    if (!['FAILED', 'TIMEOUT'].includes(job.status)) return this.publicJob(job);
    await this.store.clearJobArtifacts(id);
    await this.store.updateStatus(id, 'QUEUED');
    const correlationId = this.options.correlationId?.();
    await this.queue.enqueue({
      jobId: job.id,
      url: job.url,
      instruction: job.instruction,
      limits: (job.limits as Record<string, number>) ?? undefined,
      ai: { provider: job.aiProvider, model: job.aiModel },
      ...(correlationId ? { correlationId } : {}),
    });
    this.options.incrementMetric?.('jobs_retried_total');
    const updated = await this.store.getJob(id);
    return updated ? this.publicJob(updated) : null;
  }

  async aiInteractions(id: string, limit = 50, scope = 'anon') {
    const job = await this.ownedJob(id, scope);
    if (!job) return null;
    const size = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const calls = (await this.store.getAIInteractions(id)).slice(-size);
    return { jobId: id, provider: job.aiProvider, model: job.aiModel, count: calls.length, calls };
  }

  async stats() {
    const stats = await this.store.getStats();
    const recoveryRate = stats.commandsTotal > 0 ? stats.commandsRecovered / stats.commandsTotal : 0;
    const process = this.options.processStats?.() ?? { instance: 'unknown', uptimeSec: 0, process: {} };
    const distributed = await (this.options.getDistributedCounters?.() ?? Promise.resolve({}))
      .catch(() => ({} as Record<string, number>));
    return {
      instance: process.instance,
      uptimeSec: process.uptimeSec,
      store: this.store.kind,
      queue: this.queue.kind,
      pendingJobs: await this.queue.pendingCount().catch(() => -1),
      stats,
      aiRecoveryRate: Math.round(recoveryRate * 10000) / 10000,
      process: process.process,
      distributed,
    };
  }
}
