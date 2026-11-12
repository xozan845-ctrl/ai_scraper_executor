import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthScopedRequest } from './api-key.guard';

/** Exige rol `superadmin` (claves de entorno o usuario superadmin). */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest() as AuthScopedRequest;
    if (req.authRole !== 'superadmin') {
      throw new ForbiddenException('Se requiere rol superadmin para administrar API keys');
    }
    return true;
  }
}
