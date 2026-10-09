import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

/** FASE 9 (Dashboard) + FASE 10 (métricas §56, rate-limit §36). */

describe('MetricsCollector + logger (§38, §56)', async () => {
  const obs = await import('../libs/shared/observability/dist/index.js');

  it('contadores, gauges, snapshot y exposition Prometheus', () => {
    obs.__resetMetrics();
    const m = obs.metrics();
    m.inc('jobs_created_total');
    m.inc('jobs_created_total', 2);
    m.inc('items_extracted_total', 5, { source: 'test' });
    m.gauge('pending_jobs', 3);
    const snap = m.snapshot();
    assert.equal(snap.scraper_jobs_created_total, 3);
    assert.equal(snap.scraper_items_extracted_total, 5);
    assert.equal(snap.scraper_pending_jobs, 3);
    const prom = m.toPrometheus();
    assert.match(prom, /# TYPE scraper_jobs_created_total counter/);
    assert.match(prom, /scraper_items_extracted_total\{[^}]*source="test"[^}]*\} 5/);
    assert.match(prom, /scraper_instance_info\{[^}]*instance="[^"]+"[^}]*\} 1/);
    assert.match(prom, /# TYPE scraper_pending_jobs gauge/);
    obs.__resetMetrics();
  });

  it('logger emite JSON con nivel y respeta LOG_LEVEL', () => {
    const lines = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (s) => void lines.push(s);
    console.error = (s) => void lines.push(s);
    const prev = process.env.LOG_LEVEL;
    try {
      process.env.LOG_LEVEL = 'warn';
      obs.logger.info('invisible');
      obs.logger.error('visible', { jobId: 'j1' });
      assert.equal(lines.length, 1);
      const parsed = JSON.parse(lines[0]);
      assert.equal(parsed.level, 'error');
      assert.equal(parsed.jobId, 'j1');
      process.env.LOG_LEVEL = 'debug';
      obs.logger.debug('dbg');
      assert.equal(lines.length, 2);
    } finally {
      console.log = origLog;
      console.error = origErr;
      if (prev !== undefined) process.env.LOG_LEVEL = prev;
      else delete process.env.LOG_LEVEL;
    }
  });
});

describe('Stats con RECOVERED + endpoints de API (FASE 9)', async () => {
  const { InMemoryJobStore } = await import('../libs/infrastructure/storage/dist/memory-store.js');
  const { InMemoryJobQueue } = await import('../libs/infrastructure/queue/dist/memory-queue.js');
  const { JobsService } = await import('../apps/api/dist/jobs/jobs.service.js');
  const { MetricsController } = await import('../apps/api/dist/jobs/metrics.controller.js');

  it('getStats cuenta RECOVERED y service calcula aiRecoveryRate', async () => {
    const store = new InMemoryJobStore();
    const job = await store.createJob({ url: 'https://a.com', instruction: 'x' });
    await store.saveCommand(job.id, 'EXTRACT_LIST', {}, 'OK');
    await store.saveCommand(job.id, 'EXTRACT_LIST', {}, 'RECOVERED');
    await store.saveCommand(job.id, 'PAGINATE', {}, 'FAILED');
    await store.saveAIInteraction(job.id, { provider: 'openrouter', model: 'm', kind: 'plan', tokens: 30 });
    const stats = await store.getStats();
    assert.equal(stats.commandsTotal, 3);
    assert.equal(stats.commandsRecovered, 1);

    const service = new JobsService(store, new InMemoryJobQueue());
    const overview = await service.stats();
    assert.equal(overview.stats.commandsRecovered, 1);
    assert.equal(overview.aiRecoveryRate, 0.3333);
    assert.equal(overview.process.scraper_jobs_created_total ?? 0, 0);
  });

  it('aiInteractions: null si no existe; filas si existe', async () => {
    const store = new InMemoryJobStore();
    const service = new JobsService(store, new InMemoryJobQueue());
    assert.equal(await service.aiInteractions('job_missing'), null);
    const job = await store.createJob({ url: 'https://a.com', instruction: 'x', aiProvider: 'custom', aiModel: 'm-local' });
    await store.saveAIInteraction(job.id, { provider: 'custom', model: 'm-local', kind: 'run', tokens: 5, latencyMs: 9 });
    const r = await service.aiInteractions(job.id);
    assert.equal(r.provider, 'custom');
    assert.equal(r.calls.length, 1);
    assert.equal(r.calls[0].tokens, 5);
  });

  it('MetricsController delega overview y prometheus', async () => {
    const service = new JobsService(new InMemoryJobStore(), new InMemoryJobQueue());
    const ctrl = new MetricsController(service);
    const overview = await ctrl.overview();
    assert.ok(typeof overview.aiRecoveryRate === 'number');
    assert.ok(overview.stats);
    const { metrics } = await import('../libs/shared/observability/dist/index.js');
    metrics().inc('jobs_created_total');
    assert.match(await ctrl.prometheus(), /scraper_jobs_created_total\{[^}]*\} 1/);
  });

  it('dashboard HTML contiene los paneles y endpoints relativos', async () => {
    const { DASHBOARD_HTML } = await import('../apps/api/dist/dashboard/dashboard.js');
    for (const marker of ['id="metrics"', 'id="jobs"', 'id="detail"', 'jobs?limit', "'metrics'", "'jobs/' + current + '/execution'", "'jobs/' + current + '/results'", "'jobs/' + current + '/ai'", 'Recovery rate']) {
      assert.ok(DASHBOARD_HTML.includes(marker), `falta marcador: ${marker}`);
    }
    assert.ok(DASHBOARD_HTML.length > 5000);
  });
});

describe('Rate-limit §36 aceptado por Crawlee + métricas del worker', async () => {
  const { CrawlerService } = await import('../libs/infrastructure/crawler/dist/crawler.service.js');
  let server;
  let base;

  before(async () => {
    process.env.ALLOW_PRIVATE_HOSTS = '1';
    await new Promise((resolve) => {
      server = http
        .createServer((req, res) => {
          res.setHeader('content-type', 'text/html');
          res.end('<!doctype html><html><head><title>R</title></head><body><a href="/">x</a></body></html>');
        })
        .listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => new Promise((r) => server.close(r)));

  it('inspectSinglePage con maxRequestsPerMinute funciona', async () => {
    const svc = new CrawlerService();
    const page = await svc.inspectSinglePage(base + '/', 'http');
    assert.equal(page.title, 'R');
    // La opción existe a nivel de tipos y runtime (no lanza con el límite activo).
    const svc2 = new CrawlerService();
    const limited = await svc2.crawlDetailed({ url: base + '/', mode: 'http', maxRequests: 1, maxDepth: 0, maxRequestsPerMinute: 600 });
    assert.equal(limited.pages.length, 1);
  });

  it('processJob incrementa el collector del worker', async () => {
    const { __resetMetrics, metrics } = await import('../libs/shared/observability/dist/index.js');
    __resetMetrics();
    const { processJob } = await import('../apps/worker/dist/job-processor.js');
    const { AIOrchestrator } = await import('../libs/application/ai/dist/orchestrator/ai-orchestrator.js');
    const { ExecutionEngine } = await import('../libs/infrastructure/execution/dist/execution-engine.js');
    const { InMemoryJobStore } = await import('../libs/infrastructure/storage/dist/memory-store.js');
    const fake = {
      name: 'fake-llm',
      createPlan: async () => ({ version: '1.0', actions: [{ type: 'NAVIGATE', url: base + '/' }, { type: 'FINISH' }] }),
      analyzePage: async () => [{ type: 'FINISH' }],
      recover: async () => [{ type: 'FINISH' }],
      interpret: async (c) => c.rawItems,
      getLastStats: () => ({ latencyMs: 1, provider: 'fake-llm', model: 'm' }),
    };
    const store = new InMemoryJobStore();
    const job = await store.createJob({ url: base + '/', instruction: 'x' });
    const res = await processJob(job.id, {
      store,
      createOrchestrator: () => new AIOrchestrator(fake),
      createEngine: () => new ExecutionEngine({ fetcher: async () => '<html><head><title>t</title></head><body></body></html>' }),
    });
    assert.equal(res.status, 'COMPLETED');
    const snap = metrics().snapshot();
    assert.equal(snap.scraper_jobs_completed_total, 1);
  });
});
