/**
 * Caché JSON genérica (Redis con fallback a memoria) para respuestas LLM
 * y otros valores serializables. Clave → valor con TTL.
 */
import type { AICache } from '@ai-scraper/application-ai';
import { getRedisClient, probeRedis, ensureConnected, isMemoryFallbackAllowed, Redis } from './connection';

const PREFIX = 'jsoncache:';
const DEFAULT_TTL_MS = 10 * 60 * 1000;

export class RedisJsonCache implements AICache {
  private readonly client: Redis;
  constructor(private readonly ttlMs = DEFAULT_TTL_MS) {
    this.client = getRedisClient();
  }
  async get<T = unknown>(key: string): Promise<T | null> {
    const raw = await this.client.get(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  }
  async set(key: string, value: unknown, ttlMs?: number): Promise<void> {
    await this.client.setex(PREFIX + key, Math.ceil((ttlMs ?? this.ttlMs) / 1000), JSON.stringify(value));
  }
  async del(key: string): Promise<void> {
    await this.client.del(PREFIX + key);
  }
}

export class MemoryJsonCache implements AICache {
  private readonly map = new Map<string, { value: unknown; expiresAt: number }>();
  constructor(private readonly ttlMs = DEFAULT_TTL_MS) {}
  async get<T = unknown>(key: string): Promise<T | null> {
    const e = this.map.get(key);
    if (!e) return null;
    if (Date.now() > e.expiresAt) { this.map.delete(key); return null; }
    return structuredClone(e.value) as T;
  }
  async set(key: string, value: unknown, ttlMs?: number): Promise<void> {
    this.map.set(key, { value: structuredClone(value), expiresAt: Date.now() + (ttlMs ?? this.ttlMs) });
  }
  async del(key: string): Promise<void> { this.map.delete(key); }
}

let instance: AICache | null = null;
let initializing: Promise<AICache> | null = null;

/** Redis si disponible, si no memoria. Cachea el singleton. */
export async function getJsonCache(ttlMs?: number): Promise<AICache> {
  if (instance) return instance;
  if (initializing) return initializing;
  initializing = (async () => {
    try {
      if ((await probeRedis()) && (await ensureConnected())) {
        instance = new RedisJsonCache(ttlMs);
        console.log('[JSONCACHE] RedisJsonCache activado');
      } else {
        throw new Error('Redis no healthy');
      }
    } catch {
      if (!isMemoryFallbackAllowed()) throw new Error('Redis no disponible en producción; MemoryJsonCache deshabilitada');
      instance = new MemoryJsonCache(ttlMs);
      console.warn('[JSONCACHE] Redis no disponible — usando MemoryJsonCache');
    }
    return instance;
  })();
  try {
    return await initializing;
  } finally {
    initializing = null;
  }
}

export function __resetJsonCache(): void {
  instance = null;
  initializing = null;
}
