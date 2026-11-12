import { isPrivateHostsAllowed } from '@ai-scraper/shared-security';
import type { JobUrlPolicy } from '@ai-scraper/application-execution';

/** Dominios permitidos vía env ALLOWED_DOMAINS (coma-separados). Vacío = cualquier host público. */
export function allowedDomains(): string[] {
  return (process.env.ALLOWED_DOMAINS ?? '')
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
}

/** Política de URLs compuesta en el borde (`R-HX-5`): los casos de uso no leen entorno. */
export function jobUrlPolicy(): JobUrlPolicy {
  return { allowedDomains: allowedDomains(), allowPrivateHosts: isPrivateHostsAllowed() };
}
