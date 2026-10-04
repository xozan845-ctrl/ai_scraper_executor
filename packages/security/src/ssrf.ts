/**
 * @ai-scraper/security — SSRF (§37), fuente única.
 * Toda validación de URL del sistema debe pasar por aquí.
 * Bypass local solo con ALLOW_PRIVATE_HOSTS=1 (tests/e2e, nunca prod).
 */

const BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '169.254.169.254',
  'metadata.google.internal',
]);

const PRIVATE_PATTERNS = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^fc00:/i, /^fe80:/i];

/** true si el bypass local está habilitado (solo tests). */
export function isPrivateHostsAllowed(): boolean {
  return process.env.ALLOW_PRIVATE_HOSTS === '1';
}

export function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().trim();
  if (BLOCKED_HOSTS.has(h)) return true;
  return PRIVATE_PATTERNS.some((re) => re.test(h));
}

/** Valida protocolo + SSRF. Devuelve URL parseada o lanza. */
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
