import { Controller, Post, Get, Body, Param, Query, Headers, NotFoundException, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { JobsService } from './jobs.service';
import { CreateJobDto } from './dto/create-job.dto';
import { ApiKeyGuard, type AuthScopedRequest } from './api-key.guard';
import { CreateRateLimitGuard } from './rate-limit.guard';

/** API principal §42 (+ listado para dashboard FASE 9). ETAPA 4: auth + rate-limit. */
@ApiTags('jobs')
@UseGuards(ApiKeyGuard)
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @ApiOperation({ summary: 'Crea un job de scraping (idempotente con Idempotency-Key)' })
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Reutiliza el job si se repite la clave' })
  @UseGuards(CreateRateLimitGuard)
  @Post()
  create(
    @Body() dto: CreateJobDto,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Req() req?: AuthScopedRequest,
  ) {
    return this.jobs.create(dto, idempotencyKey || undefined, undefined, req?.authScope ?? 'anon');
  }

  @ApiOperation({ summary: 'Lista jobs (paginación por cursor + filtro por estado)' })
  @Get()
  list(
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('status') status?: string,
    @Req() req?: AuthScopedRequest,
  ) {
    return this.jobs.list(limit ? Number(limit) : undefined, { cursor, status }, req?.authScope ?? 'anon');
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Req() req?: AuthScopedRequest) {
    const job = await this.jobs.findOne(id, req?.authScope ?? 'anon');
    if (!job) throw new NotFoundException(`Job ${id} no encontrado`);
    return job;
  }

  @Get(':id/results')
  async results(@Param('id') id: string, @Req() req?: AuthScopedRequest) {
    const r = await this.jobs.results(id, req?.authScope ?? 'anon');
    if (!r) throw new NotFoundException(`Job ${id} no encontrado`);
    return r;
  }

  @Get(':id/execution')
  async execution(@Param('id') id: string, @Req() req?: AuthScopedRequest) {
    const r = await this.jobs.execution(id, req?.authScope ?? 'anon');
    if (!r) throw new NotFoundException(`Job ${id} no encontrado`);
    return r;
  }

  @Get(':id/ai')
  async ai(@Param('id') id: string, @Query('limit') limit?: string, @Req() req?: AuthScopedRequest) {
    const r = await this.jobs.aiInteractions(id, limit ? Number(limit) : undefined, req?.authScope ?? 'anon');
    if (!r) throw new NotFoundException(`Job ${id} no encontrado`);
    return r;
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @Req() req?: AuthScopedRequest) {
    const r = await this.jobs.cancel(id, req?.authScope ?? 'anon');
    if (!r) throw new NotFoundException(`Job ${id} no encontrado`);
    return r;
  }

  @Post(':id/retry')
  async retry(@Param('id') id: string, @Req() req?: AuthScopedRequest) {
    const r = await this.jobs.retry(id, req?.authScope ?? 'anon');
    if (!r) throw new NotFoundException(`Job ${id} no encontrado`);
    return r;
  }
}
