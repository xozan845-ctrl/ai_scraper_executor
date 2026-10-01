import { Controller, Get, Header } from '@nestjs/common';
import { metrics } from '@ai-scraper/observability';
import { JobsService } from './jobs.service';

/** Métricas agregadas §56 (JSON) + exposition Prometheus para Grafana §38. */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  overview() {
    return this.jobs.stats();
  }

  @Get('prometheus')
  @Header('Content-Type', 'text/plain; version=0.0.4')
  prometheus() {
    return metrics().toPrometheus();
  }
}
