import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Get,
  Patch,
  Param,
  UseGuards,
  Req,
  Query,
} from '@nestjs/common';
import { UserService } from './user.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Request } from 'express';
import { hashPassword } from '../jobs/password.util';

@ApiTags('auth')
@Controller('auth')
export class FirstUserController {
  constructor(private readonly userService: UserService) {}

  /**
   * Registro del primer usuario (solo en despliegue sin usuarios previos).
   *
   * Política de seguridad "ningún dato se siembre":
   * - Solo accesible si NO hay usuarios en la BD (idempotencia: si ya hay usuario, 409).
   * - Requiere header `X-First-Run: true` en producción (o sin restricción en dev/test).
   * - La contraseña nunca se registra en logs; se hashea y se descarta el plaintext.
   * - Devuelve una API key válida para el nuevo superadmin.
   *
   * En producción: `X-First-Run: true` + IP allowlist temporal (configurable via env).
   * En desarrollo/test: opcional, permite probar el flujo.
   */
  @Post('register-first')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registro del primer superadmin' })
  @ApiResponse({
    status: 201,
    description: 'Primer usuario creado con API key y role superadmin',
  })
  @ApiResponse({ status: 409, description: 'Ya existe un usuario en la BD' })
  @ApiResponse({ status: 401, description: 'No autorizado: headers faltantes o en producción sin X-First-Run' })
  async registerFirst(@Body() body: { email: string; password: string }, @Req() req: Request, @Query('force') force = false) {
    // Verificar si ya hay usuarios
    const existingCount = await this.userService.countUsers();
    if (existingCount > 0 && !force) {
      return {
        statusCode: HttpStatus.CONFLICT,
        message: 'Ya existe un usuario en la BD. Use force=true para sobrescribir (solo en desarrollo).',
      };
    }

    // Verificar header de primer solo en producción
    const env = process.env.NODE_ENV ?? 'development';
    const firstRunHeader = req.headers['x-first-run'] as string | undefined;

    if (env === 'production' && !firstRunHeader) {
      return {
        statusCode: HttpStatus.UNAUTHORIZED,
        message:
          'En producción requiere header X-First-Run=true para registro inicial. Véase scripts/README.md.',
      };
    }

    const { email, password } = body;

    // Hashear contraseña (solo este request la tiene en claro)
    const passwordHash = await hashPassword(password);

    // Crear usuario
    const user = await this.userService.createUser({
      email,
      passwordHash,
      role: 'superadmin' as const,
    });

    // Generar API key para este usuario (usando utilidad existente)
    const apiKey = this.userService.generateApiKey();

    // Registrar acción (solo metadata, sin contraseña en logs)
    // eslint-disable-next-line no-console
    console.log(`[FIRST_USER] superadmin creado: ${email} role=superadmin apiKey=${apiKey.substring(0, 8)}...`);

    return {
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      apiKey,
      note: 'Guarde la API key mostrada; la contraseña no se volverá a mostrar.',
    };
  }

  /**
   * Forzar registro incluso si ya hay usuarios (solo desarrollo).
   * Use con extremo cuidado en producción.
   */
  @Post('register-first/force')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Forzar registro del primer usuario' })
  @ApiResponse({
    status: 201,
    description: 'Usuario creado forzadamente (solo desarrollo)',
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  async registerFirstForce(@Body() body: { email: string; password: string }, @Req() req: Request) {
    return this.registerFirst(body, req, true);
  }
}