/**
 * Envuelve un proveedor IA con circuit breaker: si el proveedor falla de forma
 * repetida, las llamadas fallan rápido (sin colgar el job) y se recuperan solas.
 */
import { getCircuitBreaker, type CircuitBreakerOpts } from './circuit-breaker';

interface ProviderLike {
  readonly name: string;
  createPlan(ctx: unknown, opts?: unknown): Promise<unknown>;
  analyzePage(ctx: unknown, opts?: unknown): Promise<unknown[]>;
  recover(ctx: unknown, opts?: unknown): Promise<unknown[]>;
  interpret(ctx: unknown, opts?: unknown): Promise<unknown>;
  getLastStats?(): unknown;
}

const GUARDED = new Set(['createPlan', 'analyzePage', 'recover', 'interpret']);

export function withCircuitBreaker<T extends ProviderLike>(provider: T, opts?: CircuitBreakerOpts): T {
  const breaker = getCircuitBreaker(provider.name, opts);
  return new Proxy(provider, {
    get(target, prop, receiver) {
      if (prop === 'circuitState') return breaker.currentState;
      const orig = Reflect.get(target, prop, receiver) as unknown;
      if (typeof prop === 'string' && GUARDED.has(prop) && typeof orig === 'function') {
        return (...args: unknown[]) => breaker.exec(() => (orig as (...a: unknown[]) => Promise<unknown>).apply(target, args));
      }
      return typeof orig === 'function' ? (orig as (...a: unknown[]) => unknown).bind(target) : orig;
    },
  }) as T;
}
