import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus, Optional } from '@nestjs/common';
import { getRateLimiter } from '@ai-scraper/infrastructure-redis';

export interface RateLimitOpts {
  max?: number;
  windowMs?: number;
  /** Inyectable en tests para evitar Redis. Por defecto: getRateLimiter (Redis con fallback a memoria). */
  limiter?: RateLimiterLike;
}

export interface RateLimiterLike {
  consume(identifier: string, cost?: number): Promise<{ allowed: boolean; remaining: number; resetAt: number }>;
  reset?(identifier: string): Promise<void> | void;
}

function envMax(fallback: number): number {
  const n = Number(process.env.RATE_LIMIT_CREATE_PER_MIN ?? '');
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Rate-limit por IP para POST /jobs.
 * Usa `getRateLimiter()` de @ai-scraper/infrastructure-redis: RedisRateLimiter (ventana deslizante
 * distribuida, correcta con `--scale api>1`) con fallback automático a memoria si
 * Redis no responde. En tests se inyecta un limiter de memoria.
 */
@Injectable()
export class CreateRateLimitGuard implements CanActivate {
  private readonly max: number;
  private readonly windowMs: number;
  private limiter: RateLimiterLike | null;

  constructor(@Optional() opts?: RateLimitOpts) {
    this.max = opts?.max ?? envMax(30);
    this.windowMs = opts?.windowMs ?? 60_000;
    this.limiter = opts?.limiter ?? null;
  }

  private async getLimiter(): Promise<RateLimiterLike> {
    if (this.limiter) return this.limiter;
    this.limiter = await getRateLimiter({ max: this.max, windowMs: this.windowMs });
    return this.limiter;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest() as { ip?: string };
    const key = req.ip ?? 'unknown';
    const limiter = await this.getLimiter();
    const { allowed, remaining, resetAt } = await limiter.consume(key);
    const res = http.getResponse?.() as { setHeader?: (k: string, v: number) => void } | undefined;
    if (res?.setHeader) {
      res.setHeader('X-RateLimit-Limit', this.max);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', Math.ceil(resetAt / 1000));
    }
    if (!allowed) {
      throw new HttpException(
        `Rate limit excedido: máximo ${this.max} jobs/min por IP`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  /** Solo tests: limpiar estado. */
  reset(): void {
    this.limiter?.reset?.('');
  }
}
