import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, Optional, Inject } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { UserService } from './user.service';
import { API_KEY_USE_CASES } from './providers';
import type { ApiKeyUseCases } from '@ai-scraper/application-execution';

/**
 * Auth por API key.
 *
 * Acepta, en este orden:
 * 1. Claves de entorno `API_KEYS` (admin).
 * 2. Claves de cliente emitidas por `/auth/api-keys` (rol `user`).
 * 3. Clave histórica del usuario en BD (`User.apiKeyHash`).
 *
 * El rol queda en `req.authRole` para que `AdminGuard` restrinja la administración.
 */
export type AuthRole = 'superadmin' | 'user';

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
  authRole?: AuthRole;
  authKeyId?: string;
  authUserId?: string;
}

export function apiKeyScope(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    @Optional() private readonly userService?: UserService,
    @Optional() @Inject(API_KEY_USE_CASES) private readonly apiKeys?: ApiKeyUseCases,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const keys = configuredKeys();
    const req = context.switchToHttp().getRequest() as AuthScopedRequest;

    // Dev/test sin claves: abierto y con rol admin para poder probar la gestión.
    if (keys.length === 0 && process.env.NODE_ENV !== 'production') {
      const presentedDevKey = ((req.headers?.['x-api-key'] as string) ?? '').trim();
      if (presentedDevKey && this.apiKeys) {
        const client = await this.apiKeys.authenticate.execute(presentedDevKey).catch(() => null);
        if (client) {
          req.authScope = apiKeyScope(presentedDevKey);
          req.authRole = client.role;
          req.authKeyId = client.id;
          return true;
        }
      }
      req.authScope = 'anon';
      req.authRole = 'superadmin';
      req.authKeyId = 'dev';
      return true;
    }

    const presented = ((req.headers?.['x-api-key'] as string) ?? '').trim();

    if (keys.length > 0 && presented && keys.some((k) => safeEqual(k, presented))) {
      req.authScope = apiKeyScope(presented);
      req.authRole = 'superadmin';
      req.authKeyId = 'env';
      return true;
    }

    // Clave de cliente emitida por la API.
    if (presented && this.apiKeys) {
      try {
        const client = await this.apiKeys.authenticate.execute(presented);
        if (client) {
          req.authScope = apiKeyScope(presented);
          req.authRole = client.role;
          req.authKeyId = client.id;
          return true;
        }
      } catch {
        /* store caído → no autoriza */
      }
    }

    // Clave histórica del usuario en BD.
    if (presented && this.userService) {
      try {
        if (typeof this.userService.authenticateApiKey === 'function') {
          const user = await this.userService.authenticateApiKey(presented);
          if (user) {
            req.authScope = apiKeyScope(presented);
            req.authRole = user.role;
            req.authUserId = user.userId;
            return true;
          }
        } else if (await this.userService.verifyApiKey(presented)) {
          req.authScope = apiKeyScope(presented);
          req.authRole = 'superadmin';
          return true;
        }
      } catch {
        /* Mongo caído → no autoriza */
      }
    }

    if (keys.length === 0) {
      throw new UnauthorizedException('API_KEYS/FIRST_RUN_TOKEN no configurados en producción (auth fail-closed)');
    }
    throw new UnauthorizedException('API key inválida o ausente (header x-api-key)');
  }
}
