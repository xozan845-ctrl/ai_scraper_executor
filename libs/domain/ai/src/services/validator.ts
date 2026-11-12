import { ScrapingCommandSchema, ScrapingPlanSchema, type ScrapingCommand, type ScrapingPlan } from '../value-objects/schemas';
import { assertPublicUrl, isAllowedHost, normalizeDomain } from '@ai-scraper/shared-security';

/**
 * Command Validator §26 — barrera de seguridad.
 * La IA NUNCA puede elevar límites por sí misma (§35).
 */
export interface ValidatorOptions {
  allowedDomain: string;
  maxDepth: number;
  maxPages: number;
  allowedTypes?: string[];
  /** Política inyectada por el borde; el dominio no lee `process.env` (`R-HX-13`). */
  allowPrivateHosts?: boolean;
}

export class CommandValidator {
  constructor(private readonly opts: ValidatorOptions) {}

  validateCommand(raw: unknown): ScrapingCommand {
    const cmd = ScrapingCommandSchema.parse(raw);
    if (this.opts.allowedTypes && typeof cmd.type === 'string' && !this.opts.allowedTypes.includes(cmd.type)) {
      throw new Error(`Command type not allowed: ${cmd.type}`);
    }
    if ('url' in cmd && typeof (cmd as { url?: string }).url === 'string') {
      this.assertSameDomain((cmd as { url: string }).url);
    }
    if (cmd.type === 'PAGINATE' && cmd.maxPages !== undefined && cmd.maxPages > this.opts.maxPages) {
      throw new Error(`PAGINATE excede maxPages del job (${this.opts.maxPages})`);
    }
    if (cmd.type === 'FOLLOW_LINKS' && cmd.maxLinks !== undefined && cmd.maxLinks > this.opts.maxPages) {
      throw new Error(`FOLLOW_LINKS excede maxPages del job (${this.opts.maxPages})`);
    }
    return cmd;
  }

  validatePlan(raw: unknown): ScrapingPlan {
    const plan = ScrapingPlanSchema.parse(raw);
    for (const action of plan.actions) this.validateCommand(action);
    return plan;
  }

  private assertSameDomain(url: string) {
    // Fuente única SSRF (§37): primero protocolo + hosts privados, luego allowlist.
    assertPublicUrl(url, { allowPrivateHosts: this.opts.allowPrivateHosts ?? false });
    const target = new URL(url);
    const allowed = normalizeDomain(this.opts.allowedDomain);
    if (!isAllowedHost(target.hostname, allowed)) {
      throw new Error(`URL fuera del dominio permitido: ${url}`);
    }
  }
}
