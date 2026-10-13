import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard';
import { MetricsService } from './metrics.service';

/** Métricas agregadas §56 (JSON) + exposition Prometheus para Grafana §38.
 * Protegidas con ApiKeyGuard (Prometheus debe enviar header x-api-key si API_KEYS está activo). */
@UseGuards(ApiKeyGuard)
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  overview() {
    return this.metrics.overview();
  }

  @Get('prometheus')
  @Header('Content-Type', 'text/plain; version=0.0.4')
  prometheus() {
    return this.metrics.prometheus();
  }
}
