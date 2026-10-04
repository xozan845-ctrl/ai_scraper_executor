import { getRedisClient, Redis } from './connection';

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX = 30;

/** Rate limiter distribuido por IP usando sliding window log en Redis */
export class RedisRateLimiter {
  private readonly client: Redis;
  private readonly prefix: string = 'ratelimit:';
  private readonly max: number;
  private readonly windowMs: number;

  constructor(opts?: { max?: number; windowMs?: number; prefix?: string }) {
    this.client = getRedisClient();
    this.max = opts?.max ?? DEFAULT_MAX;
    this.windowMs = opts?.windowMs ?? DEFAULT_WINDOW_MS;
    if (opts?.prefix) this.prefix = opts.prefix;
  }

  private key(identifier: string): string {
    return `${this.prefix}${identifier}`;
  }

  /** Intenta consumir un slot. Returns { allowed: boolean, remaining: number, resetAt: number } */
  async consume(identifier: string, cost = 1): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const k = this.key(identifier);
    const member = `${now}-${Math.random()}`;

    const multi = this.client.multi();
    // Elimina entradas antiguas
    multi.zremrangebyscore(k, 0, windowStart);
    // Cuenta actuales
    multi.zcard(k);
    // Añade la request actual con timestamp como score
    multi.zadd(k, now, member);
    // Expira la key automáticamente
    multi.expire(k, Math.ceil(this.windowMs / 1000) + 1);
    const results = await multi.exec();

    const currentCount = (results?.[1]?.[1] as number) ?? 0;
    const allowed = currentCount + cost <= this.max;
    const remaining = Math.max(0, this.max - currentCount - cost);
    const resetAt = now + this.windowMs;

    if (!allowed) {
      // Rollback: elimina EXACTAMENTE la entrada recién insertada (mismo member).
      await this.client.zrem(k, member);
    }

    return { allowed, remaining, resetAt };
  }

  /** Middleware estilo Express */
  middleware() {
    return async (req: any, res: any, next: any) => {
      const ip = req.ip ?? req.headers['x-forwarded-for'] ?? 'unknown';
      const { allowed, remaining, resetAt } = await this.consume(ip);
      res.setHeader('X-RateLimit-Limit', this.max);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', Math.ceil(resetAt / 1000));
      if (!allowed) {
        return res.status(429).json({
          error: 'Rate limit exceeded',
          retryAfter: Math.ceil((resetAt - Date.now()) / 1000),
        });
      }
      next();
    };
  }

  async reset(identifier: string): Promise<void> {
    await this.client.del(this.key(identifier));
  }
}

/** Rate limiter en memoria (fallback/tests) */
export class MemoryRateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly max: number;
  private readonly windowMs: number;

  constructor(opts?: { max?: number; windowMs?: number }) {
    this.max = opts?.max ?? DEFAULT_MAX;
    this.windowMs = opts?.windowMs ?? DEFAULT_WINDOW_MS;
  }

  async consume(identifier: string, cost = 1): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const arr = this.hits.get(identifier) ?? [];
    const fresh = arr.filter((t) => t > windowStart);
    const allowed = fresh.length + cost <= this.max;
    if (allowed) {
      fresh.push(now);
      this.hits.set(identifier, fresh);
    }
    return { allowed, remaining: Math.max(0, this.max - fresh.length - cost), resetAt: now + this.windowMs };
  }

  middleware() {
    return async (req: any, res: any, next: any) => {
      const ip = req.ip ?? req.headers['x-forwarded-for'] ?? 'unknown';
      const { allowed, remaining, resetAt } = await this.consume(ip);
      res.setHeader('X-RateLimit-Limit', this.max);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', Math.ceil(resetAt / 1000));
      if (!allowed) return res.status(429).json({ error: 'Rate limit exceeded', retryAfter: Math.ceil((resetAt - Date.now()) / 1000) });
      next();
    };
  }

  async reset(identifier: string): Promise<void> { this.hits.delete(identifier); }
}

/** Factory rate limiter */
let rateLimiterInstance: RedisRateLimiter | MemoryRateLimiter | null = null;

export async function getRateLimiter(opts?: { max?: number; windowMs?: number }): Promise<RedisRateLimiter | MemoryRateLimiter> {
  if (rateLimiterInstance) return rateLimiterInstance;
  try {
    const healthy = await isRedisHealthy();
    if (healthy) {
      rateLimiterInstance = new RedisRateLimiter(opts);
      console.log('[RATELIMIT] RedisRateLimiter activado');
    } else throw new Error('Redis no healthy');
  } catch {
    rateLimiterInstance = new MemoryRateLimiter(opts);
    console.warn('[RATELIMIT] Redis no disponible — usando MemoryRateLimiter');
  }
  return rateLimiterInstance;
}

export async function isRedisHealthy(): Promise<boolean> {
  try {
    const c = getRedisClient();
    if (c.status !== 'ready') await c.connect();
    await c.ping();
    return true;
  } catch { return false; }
}