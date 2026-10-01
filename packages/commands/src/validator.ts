import { ScrapingCommandSchema, ScrapingPlanSchema, type ScrapingCommand, type ScrapingPlan } from './schemas';

/**
 * Command Validator §26 — barrera de seguridad.
 * La IA NUNCA puede elevar límites por sí misma (§35).
 */
export interface ValidatorOptions {
  allowedDomain: string;
  maxDepth: number;
  maxPages: number;
  allowedTypes?: string[];
}

export class CommandValidator {
  constructor(private readonly opts: ValidatorOptions) {}

  validateCommand(raw: unknown): ScrapingCommand {
    const cmd = ScrapingCommandSchema.parse(raw);
    if (this.opts.allowedTypes && !this.opts.allowedTypes.includes(cmd.type)) {
      throw new Error(`Command type not allowed: ${cmd.type}`);
    }
    if ('url' in cmd && typeof (cmd as { url?: string }).url === 'string') {
      this.assertSameDomain((cmd as { url: string }).url);
    }
    return cmd;
  }

  validatePlan(raw: unknown): ScrapingPlan {
    const plan = ScrapingPlanSchema.parse(raw);
    for (const action of plan.actions) this.validateCommand(action);
    return plan;
  }

  private assertSameDomain(url: string) {
    const target = new URL(url);
    if (!this.isAllowedHost(target.hostname)) {
      throw new Error(`URL fuera del dominio permitido: ${url}`);
    }
    if (['localhost', '127.0.0.1', '0.0.0.0'].includes(target.hostname)) {
      // Bypass solo para tests/e2e locales. En producción siempre bloqueado (§37).
      if (process.env.ALLOW_PRIVATE_HOSTS !== '1') {
        throw new Error('SSRF bloqueado: host local no permitido (§37)');
      }
    }
  }

  private isAllowedHost(hostname: string) {
    const allowed = this.opts.allowedDomain.replace(/^https?:\/\//, '').split('/')[0];
    return hostname === allowed || hostname.endsWith('.' + allowed);
  }
}
