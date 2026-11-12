/**
 * @ai-scraper/shared-security — SSRF (§37), fuente única.
 * Toda validación de URL del sistema debe pasar por aquí.
 * Bypass local solo con ALLOW_PRIVATE_HOSTS=1 y NUNCA en producción.
 */
import { promises as dns } from 'node:dns';
import * as http from 'node:http';
import * as https from 'node:https';
import { isIP } from 'node:net';

const BLOCKED_HOSTS = new Set([
  'localhost',
  'metadata.google.internal',
]);

/** Error HTTP con el código de estado tipado (para reintentos selectivos). */
export class HttpError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;

  constructor(message: string, status: number, retryAfterMs?: number) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
  }
}

/** Interpreta `Retry-After` (segundos o fecha HTTP) como milisegundos. */
function parseRetryAfterMs(value: string | string[] | undefined): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const date = Date.parse(raw);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

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
    /^192\.0\.0\./.test(h) || // IETF protocol assignments
    /^192\.0\.2\./.test(h) || // documentación
    /^192\.88\.99\./.test(h) || // relay reservado
    /^198\.(1[89])\./.test(h) || // benchmark 198.18.0.0/15
    /^198\.51\.100\./.test(h) || // documentación
    /^203\.0\.113\./.test(h) || // documentación
    /^(22[4-9]|2[3-5]\d)\./.test(h) || // multicast y reservado
    /^0\./.test(h) // esta red
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
  if (/^ff/.test(h)) return true; // multicast
  if (/^2001:db8:/.test(h)) return true; // documentación
  if (isIP(h) === 4) return isBlockedIpv4(h);
  return false;
}

export function isBlockedHost(hostname: string): boolean {
  const h = normalizeHost(hostname);
  if (BLOCKED_HOSTS.has(h)) return true;
  return isBlockedIp(h);
}

/** Lookup para clientes HTTP: valida la misma IP que se entrega al socket. */
export const safeDnsLookup: NonNullable<http.RequestOptions['lookup']> = (hostname, options, callback) => {
  void dns.lookup(hostname, { ...options, all: true }).then((addresses) => {
    if (!addresses.length) {
      callback(new Error(`DNS sin registros: ${hostname}`), '', 0);
      return;
    }
    if (!isPrivateHostsAllowed()) {
      const blocked = addresses.find((entry) => isBlockedIp(entry.address));
      if (blocked) {
        callback(new Error(`SSRF bloqueado (§37): ${hostname} resuelve a ${blocked.address}`), '', 0);
        return;
      }
    }
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0]!.address, addresses[0]!.family);
  }).catch((error: NodeJS.ErrnoException) => callback(error, '', 0));
};

export interface PublicUrlPolicyOptions {
  /** Política explícita de hosts privados; si se omite se consulta el entorno. */
  allowPrivateHosts?: boolean;
}

/**
 * Valida protocolo + SSRF por string (síncrono). Devuelve URL parseada o lanza.
 * La política de hosts privados se puede inyectar para que capas puras
 * (dominio) no dependan de `process.env` (`R-HX-13`).
 */
export function assertPublicUrl(raw: string, options?: PublicUrlPolicyOptions): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`URL inválida: ${raw}`);
  }
  if (!['http:', 'https:'].includes(u.protocol)) {
    throw new Error(`Protocolo no permitido: ${u.protocol}`);
  }
  const allowPrivateHosts = options?.allowPrivateHosts ?? isPrivateHostsAllowed();
  if (allowPrivateHosts) return u;
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

export interface SafeFetchOptions {
  /** Cabeceras sensibles: solo se envían al origin de la URL inicial. */
  headers?: Record<string, string>;
  /** Cabeceras no sensibles que pueden acompañar redirects entre origins. */
  publicHeaders?: Record<string, string>;
  credentialOrigin?: string;
  allowedDomain?: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  signal?: AbortSignal;
}

async function resolvePinnedAddress(u: URL, allowPrivateHosts = isPrivateHostsAllowed()): Promise<{ address: string; family: 4 | 6 }> {
  const host = normalizeHost(u.hostname);
  const literal = isIP(host);
  if (literal === 4 || literal === 6) return { address: host, family: literal };
  let addrs: Array<{ address: string; family: number }>;
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch {
    throw new Error(`DNS no resoluble: ${host}`);
  }
  if (!addrs.length) throw new Error(`DNS sin registros: ${host}`);
  if (!allowPrivateHosts) {
    for (const addr of addrs) {
      if (isBlockedIp(addr.address)) {
        throw new Error(`SSRF bloqueado (§37): ${host} resuelve a ${addr.address}`);
      }
    }
  }
  const chosen = addrs.find((addr) => addr.family === 4 || addr.family === 6);
  if (!chosen || (chosen.family !== 4 && chosen.family !== 6)) throw new Error(`DNS sin dirección utilizable: ${host}`);
  return { address: chosen.address, family: chosen.family };
}

function requestPinned(
  u: URL,
  target: { address: string; family: 4 | 6 },
  headers: Record<string, string>,
  timeoutMs: number,
  maxBytes: number,
  signal?: AbortSignal,
  request?: { method: 'GET' | 'POST'; body?: string },
): Promise<{ status: number; location?: string; body: string }> {
  return new Promise((resolve, reject) => {
    const transport = u.protocol === 'https:' ? https : http;
    const req = transport.request({
      protocol: u.protocol,
      hostname: target.address,
      family: target.family,
      port: u.port || undefined,
      path: `${u.pathname}${u.search}`,
      method: request?.method ?? 'GET',
      headers: { Accept: 'text/html,application/xhtml+xml', 'Accept-Encoding': 'identity', ...headers, Host: u.host },
      ...(u.protocol === 'https:' ? { servername: u.hostname } : {}),
    }, (res) => {
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (status >= 300 && status < 400) {
        res.resume();
        resolve({ status, ...(location ? { location } : {}), body: '' });
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new HttpError(`HTTP ${status} en ${u.toString()}`, status, parseRetryAfterMs(res.headers['retry-after'])));
        return;
      }
      const declared = Number(res.headers['content-length'] ?? '0');
      if (declared > maxBytes) {
        res.destroy();
        reject(new Error(`HTML demasiado grande (>${maxBytes} bytes)`));
        return;
      }
      const encoding = String(res.headers['content-encoding'] ?? 'identity').toLowerCase();
      if (encoding !== 'identity') {
        res.destroy();
        reject(new Error(`Content-Encoding no permitido: ${encoding}`));
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      res.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > maxBytes) {
          res.destroy(new Error(`HTML demasiado grande (>${maxBytes} bytes)`));
          return;
        }
        chunks.push(buffer);
      });
      res.on('end', () => resolve({ status, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Timeout HTTP (${timeoutMs}ms) en ${u.toString()}`)));
    const onAbort = () => req.destroy(signal?.reason instanceof Error ? signal.reason : new Error('Petición abortada'));
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    req.on('error', reject);
    req.on('close', () => signal?.removeEventListener('abort', onAbort));
    req.end(request?.body);
  });
}

/**
 * fetch con guardas SSRF: valida cada salto de redirect (manual) y el tamaño del body.
 * Revalida DNS + host en cada hop. Lanza ante IP privada, demasiados redirects o >maxBytes.
 */
export async function safeFetchText(
  rawUrl: string,
  opts?: SafeFetchOptions,
): Promise<SafeFetchResult> {
  const credentialHeaders = opts?.headers ?? {};
  const publicHeaders = opts?.publicHeaders ?? {};
  const timeoutMs = opts?.timeoutMs ?? 20000;
  const maxBytes = opts?.maxBytes ?? 2_000_000;
  const maxRedirects = opts?.maxRedirects ?? 5;
  const credentialOrigin = opts?.credentialOrigin ? assertPublicUrl(opts.credentialOrigin).origin : assertPublicUrl(rawUrl).origin;
  const allowedDomain = opts?.allowedDomain?.trim().toLowerCase();

  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (opts?.signal?.aborted) throw opts.signal.reason;
    const u = assertPublicUrl(current);
    if (allowedDomain && u.hostname.toLowerCase() !== allowedDomain && !u.hostname.toLowerCase().endsWith(`.${allowedDomain}`)) {
      throw new Error(`URL fuera del dominio permitido (${allowedDomain}): ${current}`);
    }
    const target = await resolvePinnedAddress(u);
    const headers = {
      ...publicHeaders,
      ...(u.origin === credentialOrigin ? credentialHeaders : {}),
    };
    const res = await requestPinned(u, target, headers, timeoutMs, maxBytes, opts?.signal);
    if (res.status >= 300 && res.status < 400) {
      if (!res.location) throw new Error(`Redirect sin Location en ${current}`);
      current = new URL(res.location, current).toString();
      continue;
    }
    return { finalUrl: current, status: res.status, html: res.body };
  }
  throw new Error(`Demasiados redirects (>${maxRedirects})`);
}

export interface SafePostJsonOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
  signal?: AbortSignal;
  /** Política inyectable para dev/tests; por defecto se lee el entorno. */
  allowPrivateHosts?: boolean;
}

/**
 * POST JSON con guardas SSRF: valida host, fija la IP resuelta y **no sigue
 * redirects** (un 3xx se rechaza para evitar saltos a hosts privados).
 */
export async function safePostJson(
  rawUrl: string,
  body: unknown,
  opts?: SafePostJsonOptions,
): Promise<{ status: number; body: string; finalUrl: string }> {
  const allowPrivateHosts = opts?.allowPrivateHosts ?? isPrivateHostsAllowed();
  const u = assertPublicUrl(rawUrl, { allowPrivateHosts });
  const target = await resolvePinnedAddress(u, allowPrivateHosts);
  const serialized = JSON.stringify(body);
  const res = await requestPinned(
    u,
    target,
    {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Content-Length': String(Buffer.byteLength(serialized)),
      ...(opts?.headers ?? {}),
    },
    opts?.timeoutMs ?? 10000,
    opts?.maxBytes ?? 64_000,
    opts?.signal,
    { method: 'POST', body: serialized },
  );
  if (res.status >= 300 && res.status < 400) {
    throw new Error(`Redirect no permitido en webhook (${res.status})`);
  }
  return { status: res.status, body: res.body, finalUrl: u.toString() };
}
