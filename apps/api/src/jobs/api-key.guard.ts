import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';

/**
 * Auth por API key (ETAPA 4).
 * Lee claves de `API_KEYS` (coma-separadas). Acepta header `x-api-key`
 * o query `?apiKey=` (útil para el dashboard SPA sin build).
 * Sin `API_KEYS` configurado: permite todo (dev/tests) — el log lo avisa.
 */
function configuredKeys(): string[] {
  return (process.env.API_KEYS ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

export function isAuthEnforced(): boolean {
  return configuredKeys().length > 0;
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (!isAuthEnforced()) return true;
    const req = context.switchToHttp().getRequest() as {
      headers?: Record<string, unknown>;
      query?: Record<string, unknown>;
    };
    const headerKey =
      (req.headers?.['x-api-key'] as string) ?? (req.headers?.['X-API-Key'] as string);
    const queryKey = req.query?.['apiKey'] as string | undefined;
    const presented = (headerKey ?? queryKey ?? '').trim();
    if (presented && configuredKeys().includes(presented)) return true;
    throw new UnauthorizedException('API key inválida o ausente (header x-api-key)');
  }
}
