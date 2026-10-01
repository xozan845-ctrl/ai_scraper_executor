import type { ScrapingJobPayload } from './types';

export const SCRAPING_QUEUE = 'scraping-jobs';

/**
 * JobQueue — cola de jobs (§12).
 * Implementaciones: BullMQJobQueue (Redis) e InMemoryJobQueue (tests/dev sin Redis).
 */
export interface JobQueue {
  readonly kind: 'bullmq' | 'memory';
  readonly queueName: string;
  enqueue(payload: ScrapingJobPayload): Promise<{ id: string }>;
  /** Elimina un job pendiente (cancelación). false si ya no está pendiente. */
  remove(jobId: string): Promise<boolean>;
  pendingCount(): Promise<number>;
  close(): Promise<void>;
}
