import type {
  AIProvider,
  PlanningContext,
  PageContext,
  RecoveryContext,
  ResultContext,
  AIProviderCallOpts,
  AIProviderStats,
} from '../interfaces/ai-provider.interface';

/** Caché mínima de respuestas IA (la implementa @ai-scraper/infrastructure-redis JsonCache). */
export interface AICache {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlMs?: number): Promise<void>;
}

const CACHE_TTL_MS = 10 * 60 * 1000;

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

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
  private lastTokens = 0;

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

  /** Tokens cobrados por la última llamada real; un hit de caché devuelve 0. */
  lastCallTokens(): number {
    return this.lastTokens;
  }

  private key(kind: string, ctx: unknown, model?: string): string {
    // Excluir 'trajectory' de la clave de caché para analyze/recover: la decisión
    // depende del contenido de la página, no del historial (R-AI-13).
    const cacheCtx = kind === 'analyze' || kind === 'recover'
      ? (({ _trajectory, ...rest }) => rest)(ctx as Record<string, unknown>)
      : ctx;
    return `llm:${kind}:${model ?? 'default'}:${djb2(JSON.stringify(cacheCtx))}`;
  }

  private async cached<T>(kind: string, ctx: unknown, model: string | undefined, opts: AIProviderCallOpts | undefined, produce: () => Promise<T>): Promise<T> {
    const run = async () => {
      if (opts?.signal?.aborted) throw opts.signal.reason;
      const result = await abortable(produce(), opts?.signal);
      this.lastTokens = this.provider.getLastStats?.()?.tokens ?? 0;
      return result;
    };
    this.lastTokens = 0;
    if (!this.cache) return run();
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
    const result = await run();
    try {
      await this.cache.set(key, result, CACHE_TTL_MS);
    } catch {
      /* noop */
    }
    return result;
  }

  async createPlan(ctx: PlanningContext, opts?: AIProviderCallOpts) {
    this.calls += 1;
    return this.cached('plan', ctx, opts?.model ?? ctx.model, opts, () => this.provider.createPlan(ctx, opts));
  }

  async analyzePage(ctx: PageContext, opts?: AIProviderCallOpts) {
    this.calls += 1;
    return this.cached('analyze', ctx, opts?.model ?? ctx.model, opts, () => this.provider.analyzePage(ctx, opts));
  }

  async recover(ctx: RecoveryContext, opts?: AIProviderCallOpts) {
    this.calls += 1;
    return this.cached('recover', ctx, opts?.model ?? ctx.model, opts, () => this.provider.recover(ctx, opts));
  }

  async interpret(ctx: ResultContext, opts?: AIProviderCallOpts) {
    this.calls += 1;
    return this.cached('interpret', ctx, opts?.model ?? ctx.model, opts, () => this.provider.interpret(ctx, opts));
  }
}
