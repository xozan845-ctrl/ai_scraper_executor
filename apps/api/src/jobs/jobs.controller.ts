import { Controller, Post, Get, Body, Param, Query, NotFoundException } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { CreateJobDto } from './dto/create-job.dto';

/** API principal §42 (+ listado para dashboard FASE 9). */
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

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
  async ai(@Param('id') id: string) {
    const r = await this.jobs.aiInteractions(id);
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
