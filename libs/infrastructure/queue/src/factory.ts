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
 * URL de Redis de la **cola** (R-RD-1): `QUEUE_REDIS_URL` si está definida y no
 * vacía, si no `REDIS_URL`. Permite separar la cola del Redis de caché/rate-limit/
 * métricas; por defecto comparten instancia (comportamiento previo).
 */
export function queueRedisUrl(): string | undefined {
  const explicit = process.env.QUEUE_REDIS_URL?.trim();
  return explicit ? explicit : process.env.REDIS_URL;
}

/**
 * Factoría FASE 7: BullMQ si la URL de la cola responde, si no memoria (dev/tests).
 * El fallback se avisa por log; nunca se oculta en silencio.
 */
export async function createJobQueue(): Promise<JobQueue> {
  if (singleton) return singleton;
  const url = queueRedisUrl();
  if (url && (await redisResponds(url))) {
    singleton = await BullMQJobQueue.connect(url);
    console.log('[QUEUE] Redis conectado (BullMQ)');
    return singleton;
  }
  if (url) console.warn('[QUEUE] Redis de cola no responde — usando cola en memoria');
  else console.warn('[QUEUE] Sin REDIS_URL ni QUEUE_REDIS_URL — usando cola en memoria');
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_IN_MEMORY_FALLBACK !== '1') {
    throw new Error('Redis/BullMQ no disponible en producción; cola en memoria deshabilitada');
  }
  singleton = new InMemoryJobQueue();
  return singleton;
}

/** Solo tests: resetea el singleton entre casos. */
export function __resetJobQueueSingleton(): void {
  singleton = null;
}

/** Cierra la cola (desconecta Redis) para apagado graceful. */
export async function closeJobQueue(): Promise<void> {
  if (singleton) {
    await singleton.close().catch(() => undefined);
    singleton = null;
  }
}
