import type {
  AIProvider,
  PlanningContext,
  PageContext,
  RecoveryContext,
  ResultContext,
  AIProviderCallOpts,
  AIProviderStats,
} from '../interfaces/ai-provider.interface';

/** Caché mínima de respuestas IA (la implementa @ai-scraper/redis JsonCache). */
export interface AICache {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlMs?: number): Promise<void>;
}

const CACHE_TTL_MS = 10 * 60 * 1000;

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * AI Orchestrator §20 — no conoce detalles del proveedor.
 * Resto de la app no sabe si la respuesta vino de OpenRouter, custom, Ollama, etc.
 * Reenvía `opts` (p. ej. { model }) para selección de modelo por job §18.
 * Si recibe `cache`, memoriza respuestas por (tipo, modelo, hash del contexto) para
 * ahorrar tokens/latencia en planes y decisiones repetidas.
 */
export class AIOrchestrator {
  private calls = 0;
  private cacheHits = 0;

  constructor(
    private readonly provider: AIProvider,
    private readonly cache?: AICache | null,
  ) {}

  get providerName() {
    return this.provider.name;
  }

  /** Nº de llamadas delegadas al proveedor (observabilidad §38). */
  get callCount() {
    return this.calls;
  }

  /** Nº de respuestas servidas desde caché (ahorro). */
  get cacheHitCount() {
    return this.cacheHits;
  }

  lastStats(): AIProviderStats | null {
    return this.provider.getLastStats?.() ?? null;
  }

  private key(kind: string, ctx: unknown, model?: string): string {
    return `llm:${kind}:${model ?? 'default'}:${djb2(JSON.stringify(ctx))}`;
  }

  private async cached<T>(kind: string, ctx: unknown, model: string | undefined, produce: () => Promise<T>): Promise<T> {
    if (!this.cache) return produce();
    const key = this.key(kind, ctx, model);
    try {
      const hit = await this.cache.get<T>(key);
      if (hit !== null && hit !== undefined) {
        this.cacheHits += 1;
        return hit;
      }
    } catch {
      /* cache error → llamar al proveedor */
    }
    const result = await produce();
    try {
      await this.cache.set(key, result, CACHE_TTL_MS);
    } catch {
      /* noop */
    }
    return result;
  }

  async createPlan(ctx: PlanningContext, opts?: AIProviderCallOpts) {
    this.calls += 1;
    return this.cached('plan', ctx, opts?.model ?? ctx.model, () => this.provider.createPlan(ctx, opts));
  }

  async analyzePage(ctx: PageContext, opts?: AIProviderCallOpts) {
    this.calls += 1;
    return this.cached('analyze', ctx, opts?.model ?? ctx.model, () => this.provider.analyzePage(ctx, opts));
  }

  async recover(ctx: RecoveryContext, opts?: AIProviderCallOpts) {
    this.calls += 1;
    return this.cached('recover', ctx, opts?.model ?? ctx.model, () => this.provider.recover(ctx, opts));
  }

  async interpret(ctx: ResultContext, opts?: AIProviderCallOpts) {
    this.calls += 1;
    return this.cached('interpret', ctx, opts?.model ?? ctx.model, () => this.provider.interpret(ctx, opts));
  }
}
