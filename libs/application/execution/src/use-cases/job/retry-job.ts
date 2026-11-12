import type { ScrapingJobPayload } from '../../dtos/scraping-job';
import type { JobQueue } from '../../ports/job-queue';
import type { JobStore } from '../../ports/job-store';
import type { JobMetrics } from '../../ports/job-metrics';
import { JobEnqueueError } from './errors';
import { toJobView, type JobView } from './job-view';

const RETRYABLE_STATUSES = ['FAILED', 'TIMEOUT', 'NEEDS_HUMAN'];

export interface RetryJobDeps {
  store: JobStore;
  queue: JobQueue;
  metrics?: JobMetrics;
}

/** Reencola un job FAILED/TIMEOUT (replay manual / DLQ) y limpia artefactos previos. */
export class RetryJobUseCase {
  constructor(private readonly deps: RetryJobDeps) {}

  async execute(id: string, scope = 'anon', correlationId?: string): Promise<JobView | null> {
    const job = await this.deps.store.getJob(id);
    if (!job || job.ownerScope !== scope) return null;
    if (!RETRYABLE_STATUSES.includes(job.status)) return toJobView(job);

    await this.deps.store.clearJobArtifacts(id);
    await this.deps.store.updateStatus(id, 'QUEUED');
    await this.deps.queue.remove(id).catch(() => false);
    try {
      await this.deps.queue.enqueue(this.toPayload(job, correlationId));
    } catch (error) {
      const message = `Reencolado fallido: ${(error as Error).message}`;
      await this.deps.store.saveError(id, message).catch(() => undefined);
      await this.deps.store.updateStatus(id, 'FAILED');
      throw new JobEnqueueError(message);
    }

    this.deps.metrics?.inc('jobs_retried_total');
    const updated = await this.deps.store.getJob(id);
    return updated ? toJobView(updated) : null;
  }

  private toPayload(job: { id: string; url: string; instruction: string; limits?: unknown; aiProvider?: string; aiModel?: string }, correlationId?: string): ScrapingJobPayload {
    return {
      jobId: job.id,
      url: job.url,
      instruction: job.instruction,
      limits: (job.limits as Record<string, number>) ?? undefined,
      ai: { provider: job.aiProvider, model: job.aiModel },
      ...(correlationId ? { correlationId } : {}),
    };
  }
}
