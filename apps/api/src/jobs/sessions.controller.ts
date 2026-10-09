import { Controller, Post, Get, Body, Param, Req, UseGuards, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SessionsService } from './sessions.service';
import { CreateSessionDto, SendMessageDto } from './dto/session.dto';
import { ApiKeyGuard, type AuthScopedRequest } from './api-key.guard';
import { CreateRateLimitGuard } from './rate-limit.guard';

/** Sesiones tipo "chat" sobre una URL (interfaz /app). */
@ApiTags('sessions')
@UseGuards(ApiKeyGuard)
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @ApiOperation({ summary: 'Crea una sesión (URL + credenciales) y lanza la radiografía' })
  @UseGuards(CreateRateLimitGuard)
  @Post()
  create(@Body() dto: CreateSessionDto, @Req() req?: AuthScopedRequest) {
    return this.sessions.create(dto, req?.authScope ?? 'anon');
  }

  @ApiOperation({ summary: 'Historial de sesiones' })
  @Get()
  list(@Req() req?: AuthScopedRequest) {
    return this.sessions.list(req?.authScope ?? 'anon');
  }

  @ApiOperation({ summary: 'Detalle de la sesión (mensajes + perfil aprendido)' })
  @Get(':id')
  async get(@Param('id') id: string, @Req() req?: AuthScopedRequest) {
    const r = await this.sessions.get(id, req?.authScope ?? 'anon');
    if (!r) throw new NotFoundException(`Sesión ${id} no encontrada`);
    return r;
  }

  @ApiOperation({ summary: 'Estado de la radiografía (RADIOGRAPHY|READY|FAILED)' })
  @Get(':id/status')
  async status(@Param('id') id: string, @Req() req?: AuthScopedRequest) {
    const r = await this.sessions.status(id, req?.authScope ?? 'anon');
    if (!r) throw new NotFoundException(`Sesión ${id} no encontrada`);
    return r;
  }

  @ApiOperation({ summary: 'Envía una instrucción (crea un job con el contexto de la sesión)' })
  @Post(':id/messages')
  async message(@Param('id') id: string, @Body() dto: SendMessageDto, @Req() req?: AuthScopedRequest) {
    const r = await this.sessions.sendMessage(id, dto, req?.authScope ?? 'anon');
    if (!r) throw new NotFoundException(`Sesión ${id} no encontrada`);
    return r;
  }
}
