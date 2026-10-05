import { Queue, Worker, type Processor } from 'bullmq';
import IORedis from 'ioredis';
import type { JobQueue } from './job-queue';
import { SCRAPING_QUEUE } from './job-queue';
import type { ScrapingJobPayload } from './types';
import { normalizePriority } from './types';

export const SCRAPING_DEAD_QUEUE = 'scraping-jobs-dead';

export interface DeadJob extends ScrapingJobPayload {
  reason: string;
  failedAt: string;
  attemptsMade: number;
}

/** Cola dead-letter: jobs que agotaron reintentos (inspección / replay manual). */
export function createDeadLetterQueue(connection: IORedis): Queue<DeadJob> {
  return new Queue<DeadJob>(SCRAPING_DEAD_QUEUE, { connection: connection as never });
}

export function createRedisConnection(url: string): IORedis {
  return new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: 5000,
  });
}

/** Cola Redis vía BullMQ (§12): reintentos, backoff y limpieza de completados. */
export class BullMQJobQueue implements JobQueue {
  readonly kind = 'bullmq' as const;
  readonly queueName = SCRAPING_QUEUE;

  constructor(
    private readonly queue: Queue<ScrapingJobPayload>,
    private readonly connection: IORedis,
    private readonly owned: boolean = true,
  ) {}

  static async connect(url: string, queueName = SCRAPING_QUEUE): Promise<BullMQJobQueue> {
    const connection = createRedisConnection(url);
    await connection.ping();
    const queue = new Queue<ScrapingJobPayload>(queueName, { connection: connection as never });
    return new BullMQJobQueue(queue, connection, true);
  }

  async enqueue(payload: ScrapingJobPayload): Promise<{ id: string }> {
    const job = await this.queue.add('scrape', payload, {
      jobId: payload.jobId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 500,
      // FASE 11: 1 = máxima prioridad en BullMQ.
      priority: normalizePriority(payload.priority),
    });
    return { id: (job.id as string) ?? payload.jobId };
  }

  async remove(jobId: string): Promise<boolean> {
    const job = await this.queue.getJob(jobId);
    if (!job) return false;
    const state = await job.getState().catch(() => 'unknown');
    if (state === 'active') return false;
    await job.remove();
    return true;
  }

  async pendingCount(): Promise<number> {
    const counts = await this.queue.getJobCounts('waiting', 'delayed', 'prioritized');
    return (counts.waiting ?? 0) + (counts.delayed ?? 0) + (counts.prioritized ?? 0);
  }

  async close(): Promise<void> {
    await this.queue.close();
    if (this.owned) this.connection.disconnect();
  }
}

/** Worker BullMQ compartido para apps/worker (procesador inyectado). */
export function createScrapingWorker(
  connection: IORedis,
  processor: Processor<ScrapingJobPayload>,
  opts?: { concurrency?: number },
): Worker<ScrapingJobPayload> {
  return new Worker<ScrapingJobPayload>(SCRAPING_QUEUE, processor, {
    connection: connection as never,
    concurrency: opts?.concurrency ?? 2,
  });
}
