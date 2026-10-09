/**
 * Allowlist de dominios por job (§37 + ETAPA 4).
 * El dominio raíz se deriva de la URL inicial del job; la IA no puede ampliarlo.
 */
import { assertPublicUrl } from './ssrf';

/**
 * Normaliza un dominio a su forma canónica: minúsculas, sin esquema, sin path ni puerto.
 * `stripWww` elimina el prefijo `www.` (para claves de perfil/sitio); por defecto NO se
 * elimina, de modo que la allowlist de un job no se amplía silenciosamente.
 */
export function normalizeDomain(input: string, opts?: { stripWww?: boolean }): string {
  const d = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]!
    .split(':')[0]!
    .trim();
  if (!d) throw new Error(`Dominio vacío: ${input}`);
  return opts?.stripWww ? d.replace(/^www\./, '') : d;
}

export function isAllowedHost(hostname: string, allowedDomain: string): boolean {
  const h = hostname.toLowerCase();
  const allowed = normalizeDomain(allowedDomain);
  return h === allowed || h.endsWith(`.${allowed}`);
}

export interface Allowlist {
  readonly root: string;
  isAllowed(url: string): boolean;
  assert(url: string): void;
}

/** Crea la allowlist inmutable de un job a partir de su URL inicial. */
export function createAllowlist(jobUrl: string): Allowlist {
  const u = assertPublicUrl(jobUrl);
  const root = u.hostname.toLowerCase();
  return {
    root,
    isAllowed(url: string): boolean {
      try {
        const t = new URL(url);
        return isAllowedHost(t.hostname, root);
      } catch {
        return false;
      }
    },
    assert(url: string): void {
      // Primero SSRF (incluso bypass local respeta protocolo), luego dominio.
      assertPublicUrl(url);
      if (!this.isAllowed(url)) {
        throw new Error(`URL fuera del dominio permitido (${root}): ${url}`);
      }
    },
  };
}
