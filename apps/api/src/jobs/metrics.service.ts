import { Injectable } from '@nestjs/common';
import { metrics } from '@ai-scraper/shared-observability';
import { getMetricsAggregator } from '@ai-scraper/infrastructure-redis';
import { JobsService } from './jobs.service';

/**
 * Métricas agregadas §56 y exposition Prometheus §38.
 * Aísla del controller el acceso a la observabilidad (local) y a los contadores
 * distribuidos (Redis) — R-HX-2, SRP.
 */
@Injectable()
export class MetricsService {
  constructor(private readonly jobs: JobsService) {}

  overview() {
    return this.jobs.stats();
  }

  async prometheus(): Promise<string> {
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
