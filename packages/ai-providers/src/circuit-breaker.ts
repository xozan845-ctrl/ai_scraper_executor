/**
 * Circuit breaker para dependencias externas (proveedor IA, etc.).
 * Tras N fallos consecutivos abre el circuito (falla rápido) durante un cooldown;
 * luego pasa a half-open y se cierra al primer éxito. Evita martillear una
 * dependencia caída y propaga el fallo sin colgar el job.
 */

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOpts {
  /** Fallos consecutivos para abrir el circuito (defecto 5). */
  threshold?: number;
  /** Tiempo que permanece abierto antes de probar de nuevo (defecto 30s). */
  cooldownMs?: number;
}

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private state: CircuitState = 'closed';
  private readonly threshold: number;
  private readonly cooldownMs: number;

  constructor(opts: CircuitBreakerOpts = {}) {
    this.threshold = opts.threshold ?? 5;
    this.cooldownMs = opts.cooldownMs ?? 30_000;
  }

  get currentState(): CircuitState {
    if (this.state === 'open' && Date.now() - this.openedAt >= this.cooldownMs) {
      this.state = 'half-open';
    }
    return this.state;
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    if (this.currentState === 'open') {
      throw new Error('CircuitBreaker abierto: dependencia no disponible (fallo rápido)');
    }
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (e) {
      this.onFailure();
      throw e;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  private onFailure(): void {
    this.failures += 1;
    if (this.state === 'half-open' || this.failures >= this.threshold) {
      this.state = 'open';
      this.openedAt = Date.now();
    }
  }

  /** Solo tests. */
  reset(): void {
    this.failures = 0;
    this.state = 'closed';
    this.openedAt = 0;
  }
}

const breakers = new Map<string, CircuitBreaker>();

/** Circuit breaker compartido por nombre (para acumular fallos entre jobs). */
export function getCircuitBreaker(name: string, opts?: CircuitBreakerOpts): CircuitBreaker {
  let b = breakers.get(name);
  if (!b) {
    b = new CircuitBreaker(opts);
    breakers.set(name, b);
  }
  return b;
}

export function __resetCircuitBreakers(): void {
  breakers.clear();
}
