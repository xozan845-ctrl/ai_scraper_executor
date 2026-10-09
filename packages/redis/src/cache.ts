import { getRedisClient, probeRedis, ensureConnected, isMemoryFallbackAllowed, Redis } from './connection';

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 min
const DEFAULT_MAX_ENTRIES = 1000;

/** Cache distribuida de páginas HTML (compartida entre workers) */
export class RedisPageCache {
  private readonly prefix: string = 'pagecache:';
  private readonly client: Redis;
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  hits = 0;
  misses = 0;

  constructor(opts?: { ttlMs?: number; maxEntries?: number; prefix?: string }) {
    this.client = getRedisClient();
    this.ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = opts?.maxEntries ?? DEFAULT_MAX_ENTRIES;
    if (opts?.prefix) this.prefix = opts.prefix;
  }

  private key(url: string): string {
    // Normaliza: host minúsculas, sin fragment, sin trailing slash
    let normalized: string;
    try {
      const u = new URL(url);
      u.hostname = u.hostname.toLowerCase();
      u.hash = '';
      if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
      normalized = u.toString();
    } catch {
      normalized = url;
    }
    return `${this.prefix}${Buffer.from(normalized).toString('base64url')}`;
  }

  async get(url: string): Promise<string | null> {
    const val = await this.client.get(this.key(url));
    if (val) {
      this.hits++;
      return val;
    }
    this.misses++;
    return null;
  }

  async set(url: string, html: string, ttlMs?: number): Promise<void> {
    const ttlSec = Math.ceil((ttlMs ?? this.ttlMs) / 1000);
    await this.client.setex(this.key(url), ttlSec, html);
    // Control de tamaño aprox (LRU simple via TTL)
  }

  async has(url: string): Promise<boolean> {
    return (await this.client.exists(this.key(url))) === 1;
  }

  async delete(url: string): Promise<void> {
    await this.client.del(this.key(url));
  }

  async clear(): Promise<void> {
    let cursor = '0';
    do {
      const [next, batch] = await this.client.scan(cursor, 'MATCH', `${this.prefix}*`, 'COUNT', 100);
      cursor = next;
      if (batch.length) await this.client.del(...batch);
    } while (cursor !== '0');
  }

  getStats(): { hits: number; misses: number; hitRate: number } {
    const total = this.hits + this.misses;
    return { hits: this.hits, misses: this.misses, hitRate: total ? this.hits / total : 0 };
  }

  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
  }
}

/** Cache en memoria fallback (tests sin Redis) */
export class MemoryPageCache {
  private readonly cache = new Map<string, { html: string; expiresAt: number }>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  hits = 0;
  misses = 0;

  constructor(opts?: { ttlMs?: number; maxEntries?: number }) {
    this.ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = opts?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  private normalize(url: string): string {
    try {
      const u = new URL(url);
      u.hostname = u.hostname.toLowerCase();
      u.hash = '';
      if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
      return u.toString();
    } catch { return url; }
  }

  get(url: string): string | null {
    const key = this.normalize(url);
    const entry = this.cache.get(key);
    if (!entry) { this.misses++; return null; }
    if (Date.now() > entry.expiresAt) { this.cache.delete(key); this.misses++; return null; }
    this.hits++;
    return entry.html;
  }

  set(url: string, html: string, ttlMs?: number): void {
    const key = this.normalize(url);
    if (!this.cache.has(key) && this.cache.size >= this.maxEntries) {
      const first = this.cache.keys().next().value;
      if (first) this.cache.delete(first);
    }
    this.cache.set(key, { html, expiresAt: Date.now() + (ttlMs ?? this.ttlMs) });
  }

  has(url: string): boolean { return this.get(url) !== null; }
  delete(url: string): void { this.cache.delete(this.normalize(url)); }
  clear(): void { this.cache.clear(); }

  getStats() { const t = this.hits + this.misses; return { hits: this.hits, misses: this.misses, hitRate: t ? this.hits / t : 0 }; }
  resetStats() { this.hits = 0; this.misses = 0; }
}

/** Factory: Redis si disponible, si no memoria */
let cacheInstance: RedisPageCache | MemoryPageCache | null = null;

export async function getPageCache(opts?: { ttlMs?: number; maxEntries?: number }): Promise<RedisPageCache | MemoryPageCache> {
  if (cacheInstance) return cacheInstance;
  try {
    if ((await isRedisHealthy()) && (await ensureConnected())) {
      cacheInstance = new RedisPageCache(opts);
      console.log('[CACHE] RedisPageCache activado');
    } else {
      throw new Error('Redis no healthy');
    }
  } catch {
    if (!isMemoryFallbackAllowed()) throw new Error('Redis no disponible en producción; MemoryPageCache deshabilitada');
    cacheInstance = new MemoryPageCache(opts);
    console.warn('[CACHE] Redis no disponible — usando MemoryPageCache');
  }
  return cacheInstance;
}

export function isRedisHealthy(): Promise<boolean> {
  return probeRedis();
}
