/**
 * Allowlist de dominios por job (§37 + ETAPA 4).
 * El dominio raíz se deriva de la URL inicial del job; la IA no puede ampliarlo.
 */
import { assertPublicUrl } from './ssrf';

export function normalizeDomain(input: string): string {
  const d = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]!
    .split(':')[0]!;
  if (!d) throw new Error(`Dominio vacío: ${input}`);
  return d;
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
