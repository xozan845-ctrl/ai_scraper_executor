import Redis from 'ioredis';

let client: Redis | null = null;
let subscriber: Redis | null = null;

/** Obtiene cliente Redis singleton (conecta si no existe) */
export function getRedisClient(url?: string): Redis {
  if (client) return client;
  const redisUrl = url ?? process.env.REDIS_URL ?? 'redis://localhost:6379';
  client = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 100, 3000),
    enableReadyCheck: true,
    lazyConnect: true,
  });
  client.on('error', (err) => console.error('[REDIS] error:', err.message));
  client.on('connect', () => console.log('[REDIS] conectado'));
  return client;
}

/** Cliente pub/sub para métricas distribuidas */
export function getRedisSubscriber(url?: string): Redis {
  if (subscriber) return subscriber;
  const redisUrl = url ?? process.env.REDIS_URL ?? 'redis://localhost:6379';
  subscriber = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 100, 3000),
  });
  return subscriber;
}

/** Conecta ambos clientes */
export async function connectRedis(url?: string): Promise<{ client: Redis; subscriber: Redis }> {
  const c = getRedisClient(url);
  const s = getRedisSubscriber(url);
  if (c.status === 'wait') await c.connect();
  if (s.status === 'wait') await s.connect();
  return { client: c, subscriber: s };
}

/** Desconecta */
export async function disconnectRedis(): Promise<void> {
  if (client) { await client.quit(); client = null; }
  if (subscriber) { await subscriber.quit(); subscriber = null; }
}

/** Verifica si Redis está disponible */
export async function isRedisHealthy(): Promise<boolean> {
  try {
    const c = getRedisClient();
    if (c.status !== 'ready') await c.connect();
    await c.ping();
    return true;
  } catch {
    return false;
  }
}

export { Redis };