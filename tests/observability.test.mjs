import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Observabilidad distribuida ETAPA 5 (instance + uptime + stats)', async () => {
  const obs = await import('../packages/observability/dist/index.js');

  it('toPrometheus etiqueta cada serie con instance + info/uptime', () => {
    process.env.INSTANCE_ID = 'test-replica-1';
    obs.__resetMetrics();
    const m = obs.metrics();
    assert.equal(m.instance, 'test-replica-1');
    m.inc('jobs_created_total');
    m.inc('items_extracted_total', 2, { source: 't' });
    const prom = m.toPrometheus();
    assert.match(prom, /scraper_jobs_created_total\{instance="test-replica-1"\} 1/);
    assert.match(prom, /scraper_items_extracted_total\{source="t",instance="test-replica-1"\} 2/);
    assert.match(prom, /scraper_instance_info\{instance="test-replica-1"\} 1/);
    assert.match(prom, /scraper_uptime_seconds\{instance="test-replica-1"\} \d+/);
    assert.ok(m.uptimeSec() >= 0);
    delete process.env.INSTANCE_ID;
    obs.__resetMetrics();
  });

  it('logger incluye instance en cada línea JSON', () => {
    process.env.INSTANCE_ID = 'test-replica-2';
    const lines = [];
    const origLog = console.log;
    console.log = (s) => void lines.push(s);
    try {
      obs.logger.info('hola', { jobId: 'j9' });
      const parsed = JSON.parse(lines[0]);
      assert.equal(parsed.instance, 'test-replica-2');
      assert.equal(parsed.jobId, 'j9');
    } finally {
      console.log = origLog;
      delete process.env.INSTANCE_ID;
    }
  });

  it('stats expone instance/uptime y process sigue numérico (global DB + local proceso)', async () => {
    const { InMemoryJobStore } = await import('../packages/storage/dist/memory-store.js');
    const { InMemoryJobQueue } = await import('../packages/queue/dist/memory-queue.js');
    const { JobsService } = await import('../apps/api/dist/jobs/jobs.service.js');
    const service = new JobsService(new InMemoryJobStore(), new InMemoryJobQueue());
    const overview = await service.stats();
    assert.ok(typeof overview.instance === 'string' && overview.instance.length > 0);
    assert.ok(typeof overview.uptimeSec === 'number');
    assert.ok(overview.stats && typeof overview.aiRecoveryRate === 'number');
    assert.ok(overview.process && typeof overview.process === 'object');
  });
});
