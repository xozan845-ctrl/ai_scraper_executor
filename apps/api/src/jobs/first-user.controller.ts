import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Req,
  UseGuards,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { UserService, hashApiKey } from './user.service';
import { CreateRateLimitGuard } from './rate-limit.guard';
import { hashPassword } from './password.util';
import { RegisterFirstDto } from './dto/register-first.dto';

/** Comparación de secretos en tiempo constante (evita timing attacks). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Registro del primer superadmin (bootstrap).
 *
 * Política de seguridad:
 * - Solo funciona si NO hay usuarios (si ya hay, 409; sin `force`).
 * - En producción exige el header `X-First-Run` igual a `FIRST_RUN_TOKEN`
 *   (fail-closed: sin token configurado, 403). En dev/test se permite si la BD está vacía.
 * - La contraseña se hashea (bcrypt) y la API key se guarda **hasheada**; en claro
 *   solo se devuelve una vez. Nunca se loguea el valor completo.
 * - Rate-limited como el resto de POST.
 */
@ApiTags('auth')
@Controller('auth')
export class FirstUserController {
  constructor(private readonly userService: UserService) {}

  @Post('register-first')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(CreateRateLimitGuard)
  @ApiOperation({ summary: 'Registro del primer superadmin (solo con BD vacía)' })
  @ApiResponse({ status: 201, description: 'Primer usuario creado; devuelve API key (una sola vez)' })
  @ApiResponse({ status: 409, description: 'Ya existe un usuario' })
  @ApiResponse({ status: 401, description: 'X-First-Run inválido o ausente (producción)' })
  @ApiResponse({ status: 403, description: 'FIRST_RUN_TOKEN no configurado (producción)' })
  async registerFirst(@Body() dto: RegisterFirstDto, @Req() req: Request) {
    this.assertBootstrapAllowed(req);

    const passwordHash = await hashPassword(dto.password);
    const apiKey = this.userService.generateApiKey();
    const user = await this.userService.createFirstUser({
      email: dto.email,
      passwordHash,
      apiKeyHash: hashApiKey(apiKey),
    });

    console.log(`[FIRST_USER] superadmin creado: ${user.email} apiKey=${apiKey.slice(0, 8)}...`);
    return {
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      apiKey,
      note: 'Guarde la API key mostrada; no se volverá a mostrar.',
    };
  }

  private assertBootstrapAllowed(req: Request): void {
    const env = process.env.NODE_ENV ?? 'development';
    if (env !== 'production') return; // dev/test: solo con BD vacía (ya validado arriba)
    const token = (process.env.FIRST_RUN_TOKEN ?? '').trim();
    if (!token) {
      throw new ForbiddenException('FIRST_RUN_TOKEN no configurado: registro inicial deshabilitado en producción');
    }
    const provided = String(req.headers['x-first-run'] ?? '');
    if (!provided || !safeEqual(provided, token)) {
      throw new UnauthorizedException('X-First-Run inválido o ausente');
    }
  }
}
