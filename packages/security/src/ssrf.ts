/**
 * @ai-scraper/security — SSRF (§37), fuente única.
 * Toda validación de URL del sistema debe pasar por aquí.
 * Bypass local solo con ALLOW_PRIVATE_HOSTS=1 y NUNCA en producción.
 */
import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';

const BLOCKED_HOSTS = new Set([
  'localhost',
  'metadata.google.internal',
]);

/** true si el bypass local está habilitado (solo tests/dev, nunca prod). */
export function isPrivateHostsAllowed(): boolean {
  return process.env.ALLOW_PRIVATE_HOSTS === '1' && process.env.NODE_ENV !== 'production';
}

/** Normaliza un host: minúsculas, sin corchetes IPv6. */
function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().trim().replace(/^\[|\]$/g, '');
}

function isBlockedIpv4(h: string): boolean {
  return (
    h === '0.0.0.0' ||
    /^127\./.test(h) || // loopback
    /^10\./.test(h) || // privada
    /^192\.168\./.test(h) || // privada
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) || // privada
    /^169\.254\./.test(h) || // link-local / metadata
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h) || // CGNAT
    /^0\./.test(h) // esto/red
  );
}

/** true para IPs privadas/loopback/link-local/mapped (v4 y v6). */
export function isBlockedIp(ip: string): boolean {
  const h = normalizeHost(ip);
  if (h === '::1' || h === '::') return true; // loopback / unspecified
  // IPv4-mapped en forma punteada (::ffff:a.b.c.d) o hex (::ffff:xxxx:xxxx)
  const mappedDotted = h.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mappedDotted) return isBlockedIpv4(mappedDotted[1]);
  const mappedHex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    const ipv4 = `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
    return isBlockedIpv4(ipv4);
  }
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true; // fc00::/7 ULA
  if (/^fe[89ab][0-9a-f]:/.test(h)) return true; // fe80::/10 link-local
  if (isIP(h) === 4) return isBlockedIpv4(h);
  return false;
}

export function isBlockedHost(hostname: string): boolean {
  const h = normalizeHost(hostname);
  if (BLOCKED_HOSTS.has(h)) return true;
  return isBlockedIp(h);
}

/** Valida protocolo + SSRF por string (síncrono). Devuelve URL parseada o lanza. */
export function assertPublicUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`URL inválida: ${raw}`);
  }
  if (!['http:', 'https:'].includes(u.protocol)) {
    throw new Error(`Protocolo no permitido: ${u.protocol}`);
  }
  if (isPrivateHostsAllowed()) return u;
  if (isBlockedHost(u.hostname)) {
    throw new Error(`SSRF bloqueado (§37): host no permitido ${u.hostname}`);
  }
  return u;
}

/**
 * Valida protocolo + SSRF resolviendo DNS (defensa contra hosts que resuelven a IPs privadas).
 * Lanza si alguna IP resuelta es privada. Síncrono `assertPublicUrl` se mantiene para checks baratos.
 */
export async function assertSafeUrl(raw: string): Promise<URL> {
  const u = assertPublicUrl(raw);
  if (isPrivateHostsAllowed()) return u;
  const host = normalizeHost(u.hostname);
  // Si el host es ya una IP literal, assertPublicUrl ya lo validó.
  if (isIP(host) !== 0) return u;
  let addrs: Array<{ address: string }>;
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch {
    throw new Error(`DNS no resoluble: ${host}`);
  }
  if (!addrs.length) throw new Error(`DNS sin registros: ${host}`);
  for (const a of addrs) {
    if (isBlockedIp(a.address)) {
      throw new Error(`SSRF bloqueado (§37): ${host} resuelve a ${a.address}`);
    }
  }
  return u;
}

export interface SafeFetchResult {
  finalUrl: string;
  status: number;
  html: string;
}

/**
 * fetch con guardas SSRF: valida cada salto de redirect (manual) y el tamaño del body.
 * Revalida DNS + host en cada hop. Lanza ante IP privada, demasiados redirects o >maxBytes.
 */
export async function safeFetchText(
  rawUrl: string,
  opts?: { headers?: Record<string, string>; timeoutMs?: number; maxBytes?: number; maxRedirects?: number },
): Promise<SafeFetchResult> {
  const headers = opts?.headers ?? {};
  const timeoutMs = opts?.timeoutMs ?? 20000;
  const maxBytes = opts?.maxBytes ?? 2_000_000;
  const maxRedirects = opts?.maxRedirects ?? 5;

  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertSafeUrl(current);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(current, { redirect: 'manual', signal: ctrl.signal, headers });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) throw new Error(`Redirect sin Location en ${current}`);
        current = new URL(loc, current).toString();
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} en ${current}`);
      const len = Number(res.headers.get('content-length') ?? '0');
      if (len > maxBytes) throw new Error(`HTML demasiado grande (>${maxBytes} bytes)`);
      const html = await res.text();
      if (html.length > maxBytes) throw new Error(`HTML demasiado grande (>${maxBytes} bytes)`);
      return { finalUrl: current, status: res.status, html };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Demasiados redirects (>${maxRedirects})`);
}
