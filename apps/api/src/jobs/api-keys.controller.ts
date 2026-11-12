import { Body, Controller, Delete, Get, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from './admin.guard';
import { ApiKeyGuard, type AuthScopedRequest } from './api-key.guard';
import { CreateRateLimitGuard } from './rate-limit.guard';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/api-key.dto';

/** Administración de API keys de cliente (solo superadmin). */
@ApiTags('auth')
@ApiHeader({ name: 'x-api-key', required: true, description: 'API key de administración (superadmin)' })
@UseGuards(ApiKeyGuard, AdminGuard)
@Controller('auth/api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @ApiOperation({ summary: 'Genera una API key de cliente (se muestra una sola vez)' })
  @ApiResponse({ status: 201, description: 'Clave creada; el campo apiKey solo aparece aquí' })
  @UseGuards(CreateRateLimitGuard)
  @Post()
  create(@Body() dto: CreateApiKeyDto, @Req() req?: AuthScopedRequest) {
    const createdBy = req?.authUserId ?? (req?.authKeyId && !['env', 'dev'].includes(req.authKeyId)
      ? req.authKeyId
      : undefined);
    return this.apiKeys.create(dto, createdBy);
  }

  @ApiOperation({ summary: 'Lista API keys emitidas (sin el secreto)' })
  @Get()
  list() {
    return this.apiKeys.list();
  }

  @ApiOperation({ summary: 'Revoca una API key de cliente' })
  @Delete(':id')
  async revoke(@Param('id') id: string) {
    const revoked = await this.apiKeys.revoke(id);
    if (!revoked) throw new NotFoundException(`API key ${id} no encontrada o ya revocada`);
    return { revoked: true, id };
  }
}
