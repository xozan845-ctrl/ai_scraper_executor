import type { JobQueue, ScrapingJobPayload } from '@ai-scraper/application-execution';
import { normalizePriority } from '@ai-scraper/application-execution';
import { SCRAPING_QUEUE } from './queue-names';

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

  /** Solo tests/worker embebido: consume pendientes con un procesador.
   * FASE 11: orden por prioridad ascendente (1 = máxima), FIFO ante empate.
   */
  async drain(processor: (payload: ScrapingJobPayload) => Promise<void>): Promise<string[]> {
    const ids = [...this.pending.keys()].sort((a, b) => {
      const pa = normalizePriority(this.pending.get(a)?.priority);
      const pb = normalizePriority(this.pending.get(b)?.priority);
      return pa - pb;
    });
    for (const id of ids) {
      const payload = this.pending.get(id)!;
      this.pending.delete(id);
      await processor(payload);
    }
    return ids;
  }
}
