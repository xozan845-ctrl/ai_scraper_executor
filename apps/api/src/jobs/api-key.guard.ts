import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';

/**
 * Auth por API key.
 * Lee claves de `API_KEYS` (coma-separadas) y acepta SOLO el header `x-api-key`
 * (no query string, para no filtrar la clave en logs/Referer).
 *
 * Política:
 * - Con claves configuradas: exige una válida (401 si no).
 * - Sin claves: abierto en dev/test; en producción **deniega** (fail-closed).
 */
function configuredKeys(): string[] {
  return (process.env.API_KEYS ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

export function isAuthEnforced(): boolean {
  return configuredKeys().length > 0 || process.env.NODE_ENV === 'production';
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const keys = configuredKeys();
    if (keys.length === 0) {
      // Sin claves: en producción se cierra por defecto; en dev/test se permite.
      if (process.env.NODE_ENV === 'production') {
        throw new UnauthorizedException('API_KEYS no configurado en producción (auth deshabilitada por seguridad)');
      }
      return true;
    }
    const req = context.switchToHttp().getRequest() as { headers?: Record<string, unknown> };
    const presented = ((req.headers?.['x-api-key'] as string) ?? '').trim();
    if (presented && keys.includes(presented)) return true;
    throw new UnauthorizedException('API key inválida o ausente (header x-api-key)');
  }
}
