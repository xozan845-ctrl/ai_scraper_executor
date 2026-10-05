import { Controller, Post, Get, Body, Param, Query, Headers, NotFoundException, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { createHash } from 'node:crypto';
import { JobsService } from './jobs.service';
import { CreateJobDto } from './dto/create-job.dto';
import { ApiKeyGuard } from './api-key.guard';
import { CreateRateLimitGuard } from './rate-limit.guard';

/** Ámbito de idempotencia: hash de la API key (o 'anon' en dev sin claves). */
function idempotencyScope(apiKey?: string): string {
  return apiKey ? createHash('sha256').update(apiKey).digest('hex').slice(0, 16) : 'anon';
}

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
    @Headers('x-api-key') apiKey?: string,
  ) {
    return this.jobs.create(dto, idempotencyKey || undefined, undefined, idempotencyScope(apiKey));
  }

  @ApiOperation({ summary: 'Lista jobs (paginación por cursor + filtro por estado)' })
  @Get()
  list(
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('status') status?: string,
  ) {
    return this.jobs.list(limit ? Number(limit) : undefined, { cursor, status });
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const job = await this.jobs.findOne(id);
    if (!job) throw new NotFoundException(`Job ${id} no encontrado`);
    return job;
  }

  @Get(':id/results')
  async results(@Param('id') id: string) {
    const r = await this.jobs.results(id);
    if (!r) throw new NotFoundException(`Job ${id} no encontrado`);
    return r;
  }

  @Get(':id/execution')
  async execution(@Param('id') id: string) {
    const r = await this.jobs.execution(id);
    if (!r) throw new NotFoundException(`Job ${id} no encontrado`);
    return r;
  }

  @Get(':id/ai')
  async ai(@Param('id') id: string, @Query('limit') limit?: string) {
    const r = await this.jobs.aiInteractions(id, limit ? Number(limit) : undefined);
    if (!r) throw new NotFoundException(`Job ${id} no encontrado`);
    return r;
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string) {
    const r = await this.jobs.cancel(id);
    if (!r) throw new NotFoundException(`Job ${id} no encontrado`);
    return r;
  }

  @Post(':id/retry')
  async retry(@Param('id') id: string) {
    const r = await this.jobs.retry(id);
    if (!r) throw new NotFoundException(`Job ${id} no encontrado`);
    return r;
  }
}
