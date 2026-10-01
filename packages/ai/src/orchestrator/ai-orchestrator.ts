import type {
  AIProvider,
  PlanningContext,
  PageContext,
  RecoveryContext,
  ResultContext,
  AIProviderCallOpts,
  AIProviderStats,
} from '../interfaces/ai-provider.interface';

/**
 * AI Orchestrator §20 — no conoce detalles del proveedor.
 * Resto de la app no sabe si la respuesta vino de OpenRouter, custom, Ollama, etc.
 * Reenvía `opts` (p. ej. { model }) para selección de modelo por job §18.
 */
export class AIOrchestrator {
  private calls = 0;

  constructor(private readonly provider: AIProvider) {}

  get providerName() {
    return this.provider.name;
  }

  /** Nº de llamadas delegadas (observabilidad §38). */
  get callCount() {
    return this.calls;
  }

  lastStats(): AIProviderStats | null {
    return this.provider.getLastStats?.() ?? null;
  }

  async createPlan(ctx: PlanningContext, opts?: AIProviderCallOpts) {
    this.calls += 1;
    return this.provider.createPlan(ctx, opts);
  }

  async analyzePage(ctx: PageContext, opts?: AIProviderCallOpts) {
    this.calls += 1;
    return this.provider.analyzePage(ctx, opts);
  }

  async recover(ctx: RecoveryContext, opts?: AIProviderCallOpts) {
    this.calls += 1;
    return this.provider.recover(ctx, opts);
  }

  async interpret(ctx: ResultContext, opts?: AIProviderCallOpts) {
    this.calls += 1;
    return this.provider.interpret(ctx, opts);
  }
}
