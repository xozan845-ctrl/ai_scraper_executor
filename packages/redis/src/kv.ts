/**
 * Caché JSON genérica (Redis con fallback a memoria) para respuestas LLM
 * y otros valores serializables. Clave → valor con TTL.
 */
import { getRedisClient, probeRedis, ensureConnected, Redis } from './connection';

export interface JsonCache {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlMs?: number): Promise<void>;
  del(key: string): Promise<void>;
}

const PREFIX = 'jsoncache:';
const DEFAULT_TTL_MS = 10 * 60 * 1000;

export class RedisJsonCache implements JsonCache {
  private readonly client: Redis;
  constructor(private readonly ttlMs = DEFAULT_TTL_MS) {
    this.client = getRedisClient();
  }
  async get<T = unknown>(key: string): Promise<T | null> {
    try {
      const raw = await this.client.get(PREFIX + key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null; // Redis no disponible → miss
    }
  }
  async set(key: string, value: unknown, ttlMs?: number): Promise<void> {
    try {
      await this.client.setex(PREFIX + key, Math.ceil((ttlMs ?? this.ttlMs) / 1000), JSON.stringify(value));
    } catch {
      /* noop */
    }
  }
  async del(key: string): Promise<void> {
    try { await this.client.del(PREFIX + key); } catch { /* noop */ }
  }
}

export class MemoryJsonCache implements JsonCache {
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

let instance: JsonCache | null = null;

/** Redis si disponible, si no memoria. Cachea el singleton. */
export async function getJsonCache(ttlMs?: number): Promise<JsonCache> {
  if (instance) return instance;
  try {
    if ((await probeRedis()) && (await ensureConnected())) {
      instance = new RedisJsonCache(ttlMs);
      console.log('[JSONCACHE] RedisJsonCache activado');
    } else {
      throw new Error('Redis no healthy');
    }
  } catch {
    instance = new MemoryJsonCache(ttlMs);
    console.warn('[JSONCACHE] Redis no disponible — usando MemoryJsonCache');
  }
  return instance;
}

export function __resetJsonCache(): void {
  instance = null;
}
