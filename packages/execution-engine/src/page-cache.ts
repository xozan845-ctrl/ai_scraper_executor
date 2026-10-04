/**
 * Caché de páginas en memoria con TTL (FASE 11, ETAPA 6).
 * Evita refetchear el mismo HTML dentro de un job (NAVIGATE repetido,
 * FOLLOW_LINKS sobre URLs ya vistas) y entre jobs de la misma réplica
 * cuando se comparte la instancia (worker).
 */

/** Normaliza para deduplicar: host en minúsculas, sin #fragment ni `/` final. */
export function normalizeUrlForDedupe(raw: string, base?: string): string {
  let abs: string;
  try {
    abs = base ? new URL(raw, base).toString() : new URL(raw).toString();
  } catch {
    return raw;
  }
  try {
    const u = new URL(abs);
    u.hostname = u.hostname.toLowerCase();
    u.hash = '';
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return abs;
  }
}

export interface PageCacheOpts {
  ttlMs?: number;
  maxEntries?: number;
}

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name] ?? '');
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export class PageCache {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly entries = new Map<string, { html: string; expiresAt: number }>();
  hits = 0;
  misses = 0;

  constructor(opts?: PageCacheOpts) {
    this.ttlMs = opts?.ttlMs ?? envInt('PAGE_CACHE_TTL_MS', 300_000);
    this.maxEntries = opts?.maxEntries ?? envInt('PAGE_CACHE_MAX_ENTRIES', 100);
  }

  get size(): number {
    return this.entries.size;
  }

  get(url: string): string | null {
    const key = normalizeUrlForDedupe(url);
    const found = this.entries.get(key);
    if (!found) {
      this.misses += 1;
      return null;
    }
    if (Date.now() > found.expiresAt) {
      this.entries.delete(key);
      this.misses += 1;
      return null;
    }
    this.hits += 1;
    return found.html;
  }

  set(url: string, html: string): void {
    const key = normalizeUrlForDedupe(url);
    if (!this.entries.has(key) && this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest) this.entries.delete(oldest);
    }
    this.entries.set(key, { html, expiresAt: Date.now() + this.ttlMs });
  }

  clear(): void {
    this.entries.clear();
    this.hits = 0;
    this.misses = 0;
  }
}
