import Redis from 'ioredis';

let client: Redis | null = null;
let subscriber: Redis | null = null;

/** Suelta el socket del event loop: las conexiones auxiliares (caché/métricas/rate-limit)
 * no deben impedir que el proceso termine. La API/worker siguen vivos por su servidor/cola. */
function unref(redis: Redis): void {
  const s = (redis as unknown as { stream?: { unref?: () => void } }).stream;
  s?.unref?.();
}

/** Obtiene cliente Redis singleton. `enableOfflineQueue:false` evita que las
 * operaciones se queden colgadas cuando Redis no responde (fallan rápido → los
 * consumidores hacen fallback). */
export function getRedisClient(url?: string): Redis {
  if (client) return client;
  const redisUrl = url ?? process.env.REDIS_URL ?? 'redis://localhost:6379';
  client = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    enableOfflineQueue: false,
    retryStrategy: (times) => Math.min(times * 200, 3000),
    enableReadyCheck: true,
    lazyConnect: true,
  });
  client.on('error', (err) => console.error('[REDIS] error:', err.message));
  client.on('connect', () => { unref(client!); console.log('[REDIS] conectado'); });
  return client;
}

/** Cliente pub/sub para métricas distribuidas */
export function getRedisSubscriber(url?: string): Redis {
  if (subscriber) return subscriber;
  const redisUrl = url ?? process.env.REDIS_URL ?? 'redis://localhost:6379';
  subscriber = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    enableOfflineQueue: false,
    retryStrategy: (times) => Math.min(times * 200, 3000),
  });
  subscriber.on('connect', () => unref(subscriber!));
  return subscriber;
}

/**
 * Comprueba Redis sin colgarse: cliente efímero SIN reintentos + carrera con timeout.
 * Devuelve false rápido si Redis no responde (para fallback a memoria).
 */
export async function probeRedis(url?: string, timeoutMs = 2000): Promise<boolean> {
  const redisUrl = url ?? process.env.REDIS_URL ?? 'redis://localhost:6379';
  const probe = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: timeoutMs,
    enableOfflineQueue: false,
    retryStrategy: () => null,
    lazyConnect: true,
  });
  probe.on('error', () => undefined);
  try {
    await Promise.race([
      (async () => {
        await probe.connect();
        await probe.ping();
      })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('redis probe timeout')), timeoutMs)),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
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
  if (client) { client.disconnect(); client = null; }
  if (subscriber) { subscriber.disconnect(); subscriber = null; }
}

/** Verifica si Redis está disponible (fail-fast, sin colgarse). */
export function isRedisHealthy(): Promise<boolean> {
  return probeRedis();
}

/** Conecta el cliente compartido si aún no lo está (para clases Redis*). */
export async function ensureConnected(url?: string): Promise<boolean> {
  const c = getRedisClient(url);
  if (c.status === 'ready') return true;
  try {
    if (c.status === 'wait' || c.status === 'end') await c.connect();
  } catch {
    return false;
  }
  const status: string = c.status;
  return status === 'ready';
}

export { Redis };
