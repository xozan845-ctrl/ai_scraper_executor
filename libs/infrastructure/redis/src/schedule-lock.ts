import { randomUUID } from 'node:crypto';
import type { ScheduleLock } from '@ai-scraper/application-execution';
import { getRedisClient, probeRedis, ensureConnected, isMemoryFallbackAllowed, Redis } from './connection';

class MemoryScheduleLock implements ScheduleLock {
  private readonly locks = new Map<string, { token: string; expiresAt: number }>();

  async acquire(key: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const current = this.locks.get(key);
    if (current && current.expiresAt > now) return false;
    this.locks.set(key, { token: randomUUID(), expiresAt: now + ttlMs });
    return true;
  }

  async release(key: string): Promise<void> {
    this.locks.delete(key);
  }
}

class RedisScheduleLock implements ScheduleLock {
  private readonly tokens = new Map<string, string>();
  constructor(private readonly client: Redis) {}

  async acquire(key: string, ttlMs: number): Promise<boolean> {
    const token = randomUUID();
    const result = await this.client.set(key, token, 'PX', Math.max(1, ttlMs), 'NX');
    if (result !== 'OK') return false;
    this.tokens.set(key, token);
    return true;
  }

  async release(key: string): Promise<void> {
    const token = this.tokens.get(key);
    if (!token) return;
    this.tokens.delete(key);
    const script = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';
    await this.client.eval(script, 1, key, token).catch(() => undefined);
  }
}

let instance: ScheduleLock | null = null;

/** Redis si responde; memoria con aviso en dev/test (`R-RD-5`). */
export async function getScheduleLock(): Promise<ScheduleLock> {
  if (instance) return instance;
  try {
    if ((await probeRedis()) && (await ensureConnected())) {
      instance = new RedisScheduleLock(getRedisClient());
      return instance;
    }
    throw new Error('Redis no healthy');
  } catch {
    if (!isMemoryFallbackAllowed()) {
      throw new Error('Redis no disponible en producción; lock del scheduler en memoria deshabilitado');
    }
    console.warn('[SCHEDULER] Redis no disponible — usando lock en memoria (una réplica)');
    instance = new MemoryScheduleLock();
    return instance;
  }
}

export function __resetScheduleLock(): void {
  instance = null;
}
