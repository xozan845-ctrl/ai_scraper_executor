import type { JobQueue } from './job-queue';
import { SCRAPING_QUEUE } from './job-queue';
import type { ScrapingJobPayload } from './types';

/** Cola en memoria: tests y dev sin Redis. Misma interfaz que BullMQ. */
export class InMemoryJobQueue implements JobQueue {
  readonly kind = 'memory' as const;
  readonly queueName = SCRAPING_QUEUE;
  private pending = new Map<string, ScrapingJobPayload>();

  async enqueue(payload: ScrapingJobPayload): Promise<{ id: string }> {
    this.pending.set(payload.jobId, { ...payload });
    return { id: payload.jobId };
  }

  async remove(jobId: string): Promise<boolean> {
    return this.pending.delete(jobId);
  }

  async pendingCount(): Promise<number> {
    return this.pending.size;
  }

  async close(): Promise<void> {
    this.pending.clear();
  }

  /** Solo tests/worker embebido: consume pendientes con un procesador. */
  async drain(processor: (payload: ScrapingJobPayload) => Promise<void>): Promise<string[]> {
    const ids = [...this.pending.keys()];
    for (const id of ids) {
      const payload = this.pending.get(id)!;
      this.pending.delete(id);
      await processor(payload);
    }
    return ids;
  }
}
