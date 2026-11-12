import { assertPublicUrl, isAllowedHost } from '@ai-scraper/shared-security';
import { JobUrlRejectedError } from './errors';

/** Política de URLs inyectada por el composition root: el caso de uso no lee entorno. */
export interface JobUrlPolicy {
  allowedDomains: string[];
  allowPrivateHosts: boolean;
}

/**
 * Valida una URL de webhook contra SSRF. No aplica ALLOWED_DOMAINS: el receptor
 * puede ser otro dominio, pero nunca un host privado (salvo bypass explícito).
 */
export function assertWebhookUrlAllowed(rawUrl: string, policy: JobUrlPolicy): URL {
  try {
    return assertPublicUrl(rawUrl, { allowPrivateHosts: policy.allowPrivateHosts });
  } catch (error) {
    throw new JobUrlRejectedError('invalid', `Webhook URL rechazada: ${(error as Error).message}`);
  }
}

/** Valida SSRF + allowlist antes de persistir (nunca jobs fantasma ni SSRF). */
export function assertJobUrlAllowed(rawUrl: string, policy: JobUrlPolicy): URL {
  let parsed: URL;
  try {
    parsed = assertPublicUrl(rawUrl, { allowPrivateHosts: policy.allowPrivateHosts });
  } catch (error) {
    throw new JobUrlRejectedError('invalid', `URL rechazada: ${(error as Error).message}`);
  }
  if (policy.allowedDomains.length > 0 && !policy.allowedDomains.some((domain) => isAllowedHost(parsed.hostname, domain))) {
    throw new JobUrlRejectedError('domain', `Dominio no permitido (ALLOWED_DOMAINS): ${parsed.hostname}`);
  }
  return parsed;
}
