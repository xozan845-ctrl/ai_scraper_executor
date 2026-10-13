import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { UserService, hashApiKey } from './user.service';
import { CreateRateLimitGuard } from './rate-limit.guard';
import { FirstRunGuard } from './first-run.guard';
import { hashPassword } from './password.util';
import { RegisterFirstDto } from './dto/register-first.dto';

/**
 * Registro del primer superadmin (bootstrap).
 *
 * Política de seguridad:
 * - Solo funciona si NO hay usuarios (si ya hay, 409; sin `force`).
 * - La puerta `X-First-Run` la aplica `FirstRunGuard` (fail-closed en producción).
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
  @UseGuards(FirstRunGuard, CreateRateLimitGuard)
  @ApiOperation({ summary: 'Registro del primer superadmin (solo con BD vacía)' })
  @ApiResponse({ status: 201, description: 'Primer usuario creado; devuelve API key (una sola vez)' })
  @ApiResponse({ status: 409, description: 'Ya existe un usuario' })
  @ApiResponse({ status: 401, description: 'X-First-Run inválido o ausente (producción)' })
  @ApiResponse({ status: 403, description: 'FIRST_RUN_TOKEN no configurado (producción)' })
  async registerFirst(@Body() dto: RegisterFirstDto) {
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
}
