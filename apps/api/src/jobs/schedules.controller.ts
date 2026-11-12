import { Body, Controller, Delete, Get, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard, type AuthScopedRequest } from './api-key.guard';
import { CreateRateLimitGuard } from './rate-limit.guard';
import { SchedulesService } from './schedules.service';
import { CreateScheduleDto } from './dto/schedule.dto';

/** Jobs recurrentes por intervalo fijo. */
@ApiTags('schedules')
@UseGuards(ApiKeyGuard)
@Controller('schedules')
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @ApiOperation({ summary: 'Crea un job recurrente (intervalo fijo en segundos)' })
  @UseGuards(CreateRateLimitGuard)
  @Post()
  create(@Body() dto: CreateScheduleDto, @Req() req?: AuthScopedRequest) {
    return this.schedules.create(dto, req?.authScope ?? 'anon');
  }

  @ApiOperation({ summary: 'Lista schedules del usuario' })
  @Get()
  list(@Req() req?: AuthScopedRequest) {
    return this.schedules.list(req?.authScope ?? 'anon');
  }

  @ApiOperation({ summary: 'Detalle de un schedule' })
  @Get(':id')
  async get(@Param('id') id: string, @Req() req?: AuthScopedRequest) {
    const schedule = await this.schedules.get(id, req?.authScope ?? 'anon');
    if (!schedule) throw new NotFoundException(`Schedule ${id} no encontrado`);
    return schedule;
  }

  @ApiOperation({ summary: 'Pausa un schedule' })
  @Post(':id/pause')
  async pause(@Param('id') id: string, @Req() req?: AuthScopedRequest) {
    const schedule = await this.schedules.pause(id, req?.authScope ?? 'anon');
    if (!schedule) throw new NotFoundException(`Schedule ${id} no encontrado`);
    return schedule;
  }

  @ApiOperation({ summary: 'Reanuda un schedule y recalcula nextRunAt' })
  @Post(':id/resume')
  async resume(@Param('id') id: string, @Req() req?: AuthScopedRequest) {
    const schedule = await this.schedules.resume(id, req?.authScope ?? 'anon');
    if (!schedule) throw new NotFoundException(`Schedule ${id} no encontrado`);
    return schedule;
  }

  @ApiOperation({ summary: 'Elimina un schedule' })
  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req?: AuthScopedRequest) {
    const removed = await this.schedules.remove(id, req?.authScope ?? 'anon');
    if (!removed) throw new NotFoundException(`Schedule ${id} no encontrado`);
    return { deleted: true, id };
  }
}
