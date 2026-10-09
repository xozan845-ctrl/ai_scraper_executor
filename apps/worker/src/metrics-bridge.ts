/**
 * Puente de métricas: registra en el collector local (Prometheus por réplica)
 * Y en el agregador Redis (vista global entre workers, que no exponen HTTP).
 * Las llamadas a Redis son fire-and-forget: nunca bloquean ni rompen el job.
 */
import { metrics } from '@ai-scraper/shared-observability';
import { getMetricsAggregator } from '@ai-scraper/redis';

export function incMetric(name: string, by = 1, labels?: Record<string, string>): void {
  metrics().inc(name, by, labels);
  void getMetricsAggregator()
    .then((m) => m.inc(name, by, labels))
    .catch(() => undefined);
}

export function gaugeMetric(name: string, value: number, labels?: Record<string, string>): void {
  metrics().gauge(name, value, labels);
  void getMetricsAggregator()
    .then((m) => m.gauge(name, value, labels))
    .catch(() => undefined);
}
