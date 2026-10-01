import IORedis from 'ioredis';
import type { JobQueue } from './job-queue';
import { InMemoryJobQueue } from './memory-queue';
import { BullMQJobQueue } from './bullmq-queue';

let singleton: JobQueue | null = null;

async function redisResponds(url: string, timeoutMs = 2500): Promise<boolean> {
  const client = new IORedis(url, {
    connectTimeout: timeoutMs,
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
    retryStrategy: () => null,
  });
  try {
    await Promise.race([
      client.ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('redis timeout')), timeoutMs)),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    client.disconnect();
  }
}

/**
 * Factoría FASE 7: BullMQ si REDIS_URL responde, si no memoria (dev/tests).
 * El fallback se avisa por log; nunca se oculta en silencio.
 */
export async function createJobQueue(): Promise<JobQueue> {
  if (singleton) return singleton;
  const url = process.env.REDIS_URL;
  if (url && (await redisResponds(url))) {
    singleton = await BullMQJobQueue.connect(url);
    console.log('[QUEUE] Redis conectado (BullMQ)');
    return singleton;
  }
  if (url) console.warn('[QUEUE] REDIS_URL no responde — usando cola en memoria');
  else console.warn('[QUEUE] Sin REDIS_URL — usando cola en memoria');
  singleton = new InMemoryJobQueue();
  return singleton;
}

/** Solo tests: resetea el singleton entre casos. */
export function __resetJobQueueSingleton(): void {
  singleton = null;
}
