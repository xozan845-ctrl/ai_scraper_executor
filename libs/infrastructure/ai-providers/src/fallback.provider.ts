/**
 * FallbackAIProvider — evolución §19.
 * Intenta cada proveedor en orden; si uno falla (caída, 429 persistente,
 * timeout), pasa al siguiente. Solo falla el job si fallan todos.
 */
import type { AIProviderCallOpts as ProviderCallOpts, AIProviderStats as ProviderStats } from '@ai-scraper/application-ai';

interface DelegateProvider {
  readonly name: string;
  createPlan(c: Record<string, unknown>, opts?: ProviderCallOpts): Promise<unknown>;
  analyzePage(c: Record<string, unknown>, opts?: ProviderCallOpts): Promise<unknown[]>;
  recover(c: Record<string, unknown>, opts?: ProviderCallOpts): Promise<unknown[]>;
  interpret(c: Record<string, unknown>, opts?: ProviderCallOpts): Promise<unknown>;
  getLastStats?(): ProviderStats | null;
}

export class FallbackAIProvider {
  readonly name: string;
  private lastStats: ProviderStats | null = null;

  constructor(private readonly chain: DelegateProvider[]) {
    if (chain.length === 0) throw new Error('FallbackAIProvider requiere al menos un proveedor');
    this.name = `fallback(${chain.map((p) => p.name).join(',')})`;
  }

  getLastStats(): ProviderStats | null {
    return this.lastStats;
  }

  private async tryEach<T>(kind: string, fn: (p: DelegateProvider) => Promise<T>): Promise<T> {
    const errors: string[] = [];
    for (const p of this.chain) {
      try {
        const result = await fn(p);
        this.lastStats = p.getLastStats?.() ?? null;
        return result;
      } catch (e) {
        errors.push(`${p.name}: ${(e as Error).message}`);
      }
    }
    throw new Error(`All AI providers failed [${kind}]: ${errors.join(' | ')}`);
  }

  createPlan(c: Record<string, unknown>, opts?: ProviderCallOpts) {
    return this.tryEach('createPlan', (p) => p.createPlan(c, opts));
  }

  analyzePage(c: Record<string, unknown>, opts?: ProviderCallOpts) {
    return this.tryEach('analyzePage', (p) => p.analyzePage(c, opts));
  }

  recover(c: Record<string, unknown>, opts?: ProviderCallOpts) {
    return this.tryEach('recover', (p) => p.recover(c, opts));
  }

  interpret(c: Record<string, unknown>, opts?: ProviderCallOpts) {
    return this.tryEach('interpret', (p) => p.interpret(c, opts));
  }
}
