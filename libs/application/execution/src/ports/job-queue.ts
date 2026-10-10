import type { ScrapingJobPayload } from '../dtos/scraping-job';

export interface JobQueue {
  readonly kind: 'bullmq' | 'memory';
  readonly queueName: string;
  enqueue(payload: ScrapingJobPayload): Promise<{ id: string }>;
  remove(jobId: string): Promise<boolean>;
  pendingCount(): Promise<number>;
  close(): Promise<void>;
}
