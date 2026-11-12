import { Controller, Post, Get, Body, Param, Query, Headers, NotFoundException, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { JobsService } from './jobs.service';
import { JobEventsService } from './job-events.service';
import { CreateJobDto } from './dto/create-job.dto';
import { ApiKeyGuard, type AuthScopedRequest } from './api-key.guard';
import { CreateRateLimitGuard } from './rate-limit.guard';

/** API principal §42 (+ listado para dashboard FASE 9). ETAPA 4: auth + rate-limit. */
@ApiTags('jobs')
@UseGuards(ApiKeyGuard)
@Controller('jobs')
export class JobsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly jobEvents: JobEventsService,
  ) {}

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

  @Get(':id/events')
  async events(
    @Param('id') id: string,
    @Res() res: Response,
    @Req() req?: AuthScopedRequest,
  ) {
    const job = await this.jobs.findOne(id, req?.authScope ?? 'anon');
    if (!job) throw new NotFoundException(`Job ${id} no encontrado`);

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    res.write('retry: 3000\n\n');
    send('snapshot', { jobId: id, status: job.status, url: job.url, updatedAt: job.updatedAt });

    if (['COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT'].includes(job.status)) {
      res.end();
      return;
    }

    const unsubscribe = await this.jobEvents.subscribe(id, (event) => {
      send('progress', event);
      if (event.type === 'job.finished') setTimeout(() => res.end(), 50);
    });
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);
    res.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
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
