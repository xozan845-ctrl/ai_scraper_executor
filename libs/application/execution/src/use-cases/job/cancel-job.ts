import type { JobQueue } from '../../ports/job-queue';
import type { JobStore } from '../../ports/job-store';
import type { JobMetrics } from '../../ports/job-metrics';
import { toJobView, type JobView } from './job-view';

const TERMINAL_STATUSES = ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT'];

export interface CancelJobDeps {
  store: JobStore;
  queue: JobQueue;
  metrics?: JobMetrics;
}

/** Cancela un job no terminal: lo saca de la cola y persiste CANCELLED. */
export class CancelJobUseCase {
  constructor(private readonly deps: CancelJobDeps) {}

  async execute(id: string, scope = 'anon'): Promise<JobView | null> {
    const job = await this.deps.store.getJob(id);
    if (!job || job.ownerScope !== scope) return null;
    if (TERMINAL_STATUSES.includes(job.status)) return toJobView(job);

    await this.deps.queue.remove(id).catch(() => false);
    this.deps.metrics?.inc('jobs_cancelled_total');
    const updated = await this.deps.store.updateStatus(id, 'CANCELLED');
    return updated ? toJobView(updated) : null;
  }
}
