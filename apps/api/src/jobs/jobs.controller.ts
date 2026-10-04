import { Controller, Post, Get, Body, Param, Query, NotFoundException, UseGuards } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { CreateJobDto } from './dto/create-job.dto';
import { ApiKeyGuard } from './api-key.guard';
import { CreateRateLimitGuard } from './rate-limit.guard';

/** API principal §42 (+ listado para dashboard FASE 9). ETAPA 4: auth + rate-limit. */
@UseGuards(ApiKeyGuard)
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @UseGuards(CreateRateLimitGuard)
  @Post()
  create(@Body() dto: CreateJobDto) {
    return this.jobs.create(dto);
  }

  @Get()
  list(@Query('limit') limit?: string) {
    return this.jobs.list(limit ? Number(limit) : undefined);
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
}
