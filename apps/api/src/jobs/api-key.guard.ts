import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, Optional } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { UserService } from './user.service';

/**
 * Auth por API key.
 *
 * Acepta dos fuentes, en este orden:
 * 1. Claves de entorno `API_KEYS` (coma-separadas), por header `x-api-key`.
 * 2. Claves de usuario registradas en BD (hash SHA-256), vía `UserService`.
 *    Esto permite que la API key devuelta por `/auth/register-first` autentique.
 *
 * Política:
 * - Con claves de entorno configuradas: exige una válida.
 * - Sin claves de entorno: abierto en dev/test; en producción, solo claves de BD;
 *   si no hay ninguna → 401 (fail-closed).
 * - Solo header `x-api-key` (nunca query string: evita fugas en logs/Referer).
 */
function configuredKeys(): string[] {
  return (process.env.API_KEYS ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function isAuthEnforced(): boolean {
  return configuredKeys().length > 0 || process.env.NODE_ENV === 'production';
}

export interface AuthScopedRequest {
  headers?: Record<string, unknown>;
  authScope?: string;
}

export function apiKeyScope(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(@Optional() private readonly userService?: UserService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const keys = configuredKeys();
    // Dev/test sin claves de entorno: abierto (comportamiento histórico).
    const req = context.switchToHttp().getRequest() as AuthScopedRequest;
    if (keys.length === 0 && process.env.NODE_ENV !== 'production') {
      req.authScope = 'anon';
      return true;
    }
    const presented = ((req.headers?.['x-api-key'] as string) ?? '').trim();

    if (keys.length > 0 && presented && keys.some((k) => safeEqual(k, presented))) {
      req.authScope = apiKeyScope(presented);
      return true;
    }

    // Clave de usuario en BD (sin romper si Mongo no responde: no autoriza).
    if (presented && this.userService) {
      try {
        if (await this.userService.verifyApiKey(presented)) {
          req.authScope = apiKeyScope(presented);
          return true;
        }
      } catch {
        /* Mongo caído → se trata como no autorizado */
      }
    }

    if (keys.length === 0) {
      throw new UnauthorizedException('API_KEYS/FIRST_RUN_TOKEN no configurados en producción (auth fail-closed)');
    }
    throw new UnauthorizedException('API key inválida o ausente (header x-api-key)');
  }
}
