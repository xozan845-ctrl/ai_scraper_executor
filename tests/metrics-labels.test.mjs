import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Métricas: gauges con labels (no se pisan) y parseo correcto del campo
 * `instance:labels` (el JSON de labels contiene ':').
 */
describe('Métricas: gauges con labels y parseo de campos', async () => {
  const { MetricsCollector } = await import('../packages/observability/dist/metrics.js');
  const { parseGaugeField } = await import('../packages/redis/dist/metrics.js');

  it('gauges con labels distintos coexisten; misma etiqueta se actualiza', () => {
    const mc = new MetricsCollector('scraper', 'inst-a');
    mc.gauge('queue_depth', 3, { q: 'a' });
    mc.gauge('queue_depth', 7, { q: 'b' });
    mc.gauge('queue_depth', 5, { q: 'a' }); // reemplaza, no suma

    assert.equal(mc.snapshot().scraper_queue_depth, 12, 'suma de series (5 + 7)');

    const prom = mc.toPrometheus();
    assert.ok(prom.includes('scraper_queue_depth{q="a",instance="inst-a"} 5'), 'serie a actualizada');
    assert.ok(prom.includes('scraper_queue_depth{q="b",instance="inst-a"} 7'), 'serie b independiente');
  });

  it('parseGaugeField separa por el PRIMER ":" aunque el JSON de labels tenga ":"', () => {
    assert.deepEqual(parseGaugeField('host-123:{"q":"a:b"}'), { instance: 'host-123', labels: '{"q":"a:b"}' });
    assert.deepEqual(parseGaugeField('host-123:{"q":"a"}'), { instance: 'host-123', labels: '{"q":"a"}' });
    assert.deepEqual(parseGaugeField('sinlabels'), { instance: 'sinlabels', labels: '' });
  });
});
