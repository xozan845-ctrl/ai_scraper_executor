import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';

export interface RateLimitOpts {
  max?: number;
  windowMs?: number;
}

function envMax(fallback: number): number {
  const n = Number(process.env.RATE_LIMIT_CREATE_PER_MIN ?? '');
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Rate-limit en memoria por IP para POST /jobs (ETAPA 4).
 * Ventana deslizante simple; suficiente para MVP single-replica.
 * Multi-réplica real iría a Redis (ETAPA 5/6).
 */
@Injectable()
export class CreateRateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, number[]>();
  private readonly max: number;
  private readonly windowMs: number;

  constructor(opts?: RateLimitOpts) {
    this.max = opts?.max ?? envMax(30);
    this.windowMs = opts?.windowMs ?? 60_000;
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest() as { ip?: string };
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    const window = this.hits.get(key) ?? [];
    const fresh = window.filter((t) => now - t < this.windowMs);
    if (fresh.length >= this.max) {
      throw new HttpException(
        `Rate limit excedido: máximo ${this.max} jobs/min por IP`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    fresh.push(now);
    this.hits.set(key, fresh);
    return true;
  }

  /** Solo tests: limpiar estado. */
  reset(): void {
    this.hits.clear();
  }
}
