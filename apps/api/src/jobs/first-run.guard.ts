import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

/** Comparación de secretos en tiempo constante (evita timing attacks). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

interface BootstrapRequest {
  headers?: Record<string, unknown>;
}

/**
 * Puerta del bootstrap (`/auth/register-first`).
 *
 * Política de seguridad (misma que antes, ahora como guard):
 * - En producción exige el header `X-First-Run` igual a `FIRST_RUN_TOKEN`
 *   (fail-closed: sin token configurado, 403).
 * - En dev/test se permite (la unicidad del primer usuario la valida el servicio).
 *
 * La decisión de acceso vive aquí (guard), no en el controller — OCP.
 */
@Injectable()
export class FirstRunGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const env = process.env.NODE_ENV ?? 'development';
    if (env !== 'production') return true;
    const token = (process.env.FIRST_RUN_TOKEN ?? '').trim();
    if (!token) {
      throw new ForbiddenException('FIRST_RUN_TOKEN no configurado: registro inicial deshabilitado en producción');
    }
    const req = context.switchToHttp().getRequest<BootstrapRequest>();
    const provided = String(req.headers?.['x-first-run'] ?? '');
    if (!provided || !safeEqual(provided, token)) {
      throw new UnauthorizedException('X-First-Run inválido o ausente');
    }
    return true;
  }
}
