import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { metrics } from '@ai-scraper/observability';
import { getMetricsAggregator } from '@ai-scraper/redis';
import { JobsService } from './jobs.service';
import { ApiKeyGuard } from './api-key.guard';

/** Métricas agregadas §56 (JSON) + exposition Prometheus para Grafana §38.
 * Protegidas con ApiKeyGuard (Prometheus debe enviar header x-api-key si API_KEYS está activo). */
@UseGuards(ApiKeyGuard)
@Controller('metrics')
export class MetricsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  overview() {
    return this.jobs.stats();
  }

  @Get('prometheus')
  @Header('Content-Type', 'text/plain; version=0.0.4')
  async prometheus() {
    // Métricas locales de la réplica (con label `instance`) ...
    let out = metrics().toPrometheus();
    // ... + contadores distribuidos (suma global entre réplicas/workers vía Redis).
    try {
      const agg = await getMetricsAggregator();
      const counters = await agg.getAllCounters();
      const lines: string[] = [];
      for (const [name, value] of Object.entries(counters)) {
        const metric = `scraper_distributed_${name}`;
        lines.push(`# TYPE ${metric} counter`);
        lines.push(`${metric} ${value}`);
      }
      if (lines.length) out += `\n${lines.join('\n')}\n`;
    } catch {
      /* Redis no disponible: solo métricas locales */
    }
    return out;
  }
}
