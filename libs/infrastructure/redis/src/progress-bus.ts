import type { ProgressEvent } from '@ai-scraper/application-scraper';
import { connectRedis, getRedisSubscriber, isMemoryFallbackAllowed, probeRedis } from './connection';

type Handler = (event: ProgressEvent) => void;

const handlers = new Map<string, Set<Handler>>();
const subscribed = new Set<string>();
let redisAvailable: boolean | null = null;
let messageListenerInstalled = false;

function channel(jobId: string): string {
  return `job-progress:${jobId}`;
}

function dispatch(event: ProgressEvent): void {
  for (const handler of handlers.get(event.jobId) ?? []) {
    try { handler(event); } catch { /* noop */ }
  }
}

async function ensureRedis(): Promise<boolean> {
  if (redisAvailable !== null) return redisAvailable;
  if (process.env.PROGRESS_BUS_MEMORY === '1') {
    redisAvailable = false;
    return false;
  }
  redisAvailable = await probeRedis();
  if (redisAvailable) await connectRedis();
  if (!redisAvailable && !isMemoryFallbackAllowed()) {
    throw new Error('Redis no disponible en producción para progreso en vivo');
  }
  return redisAvailable;
}

function installMessageListener(): void {
  if (messageListenerInstalled) return;
  messageListenerInstalled = true;
  const subscriber = getRedisSubscriber();
  subscriber.on('message', (receivedChannel: string, payload: string) => {
    if (!receivedChannel.startsWith('job-progress:')) return;
    try { dispatch(JSON.parse(payload) as ProgressEvent); } catch { /* noop */ }
  });
}

/** Publica un evento de progreso; si Redis no está, lo entrega en memoria. */
export async function publishProgress(event: ProgressEvent): Promise<void> {
  try {
    if (await ensureRedis()) {
      const { client } = await connectRedis();
      await client.publish(channel(event.jobId), JSON.stringify(event));
      return;
    }
  } catch {
    redisAvailable = false;
  }
  dispatch(event);
}

/** Suscribe a eventos de un job. Devuelve la función de limpieza. */
export async function subscribeProgress(jobId: string, handler: Handler): Promise<() => void> {
  const set = handlers.get(jobId) ?? new Set<Handler>();
  set.add(handler);
  handlers.set(jobId, set);

  try {
    if (await ensureRedis()) {
      installMessageListener();
      if (!subscribed.has(jobId)) {
        const subscriber = getRedisSubscriber();
        await subscriber.subscribe(channel(jobId));
        subscribed.add(jobId);
      }
    }
  } catch {
    redisAvailable = false;
  }

  return () => {
    const current = handlers.get(jobId);
    if (!current) return;
    current.delete(handler);
    if (current.size === 0) {
      handlers.delete(jobId);
      if (subscribed.delete(jobId)) {
        void getRedisSubscriber().unsubscribe(channel(jobId)).catch(() => undefined);
      }
    }
  };
}

export function __resetProgressBus(): void {
  handlers.clear();
  subscribed.clear();
  redisAvailable = null;
  messageListenerInstalled = false;
}
