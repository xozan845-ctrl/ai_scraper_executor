import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * FASE 7 (Persistencia) + FASE 8 (API real).
 * Sin Docker: memoria. Con DATABASE_URL válido: también smoke en PostgreSQL.
 */

const SHOP_HTML = `<!doctype html><html><head><title>Shop Persist</title></head><body>
<div class="product-card"><span class="name">Persist Uno</span><span class="price">$5</span></div>
</body></html>`;

describe('InMemoryJobStore (§40)', async () => {
  const { InMemoryJobStore } = await import('../packages/storage/dist/memory-store.js');

  it('CRUD de job + artefactos + listado', async () => {
    const store = new InMemoryJobStore();
    assert.equal(store.kind, 'memory');
    const job = await store.createJob({ url: 'https://a.com', instruction: 'x', aiProvider: 'openrouter' });
    assert.equal(job.status, 'QUEUED');

    await store.updateStatus(job.id, 'EXECUTING');
    assert.equal((await store.getJob(job.id)).status, 'EXECUTING');

    await store.savePlan(job.id, { version: '1.0', actions: [] });
    await store.saveCommand(job.id, 'NAVIGATE', { type: 'NAVIGATE' }, 'OK');
    await store.saveCommand(job.id, 'FINISH', { type: 'FINISH' }, 'OK');
    await store.savePage(job.id, 'https://a.com/', 'A', 0);
    await store.savePage(job.id, 'https://a.com/', 'A', 0); // dedup
    await store.saveResults(job.id, [{ data: { a: 1 }, sourceUrl: 'https://a.com/', selector: '.x' }]);
    await store.saveError(job.id, 'boom', { step: 2 });
    await store.saveAIInteraction(job.id, { provider: 'openrouter', model: 'm', kind: 'plan', tokens: 10, latencyMs: 5 });

    assert.equal((await store.getCommands(job.id)).length, 2);
    assert.equal((await store.getPages(job.id)).length, 1);
    assert.equal((await store.getResults(job.id)).length, 1);
    assert.equal((await store.getErrors(job.id)).length, 1);
    assert.equal((await store.listJobs()).length, 1);
    assert.equal(await store.getJob('job_missing'), null);
  });
});

describe('Cola en memoria + factoría (§12)', async () => {
  const { InMemoryJobQueue } = await import('../packages/queue/dist/memory-queue.js');

  it('enqueue/remove/pending/drain', async () => {
    const q = new InMemoryJobQueue();
    assert.equal(q.kind, 'memory');
    await q.enqueue({ jobId: 'j1', url: 'https://a.com', instruction: 'x' });
    await q.enqueue({ jobId: 'j2', url: 'https://b.com', instruction: 'y' });
    assert.equal(await q.pendingCount(), 2);
    assert.equal(await q.remove('j1'), true);
    assert.equal(await q.remove('j1'), false);
    const seen = [];
    await q.drain(async (p) => void seen.push(p.jobId));
    assert.deepEqual(seen, ['j2']);
    assert.equal(await q.pendingCount(), 0);
  });

  it('factoría sin REDIS_URL devuelve memoria', async () => {
    const prev = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    const { createJobQueue, __resetJobQueueSingleton } = await import('../packages/queue/dist/factory.js');
    __resetJobQueueSingleton();
    const q = await createJobQueue();
    assert.equal(q.kind, 'memory');
    await q.close();
    __resetJobQueueSingleton();
    if (prev !== undefined) process.env.REDIS_URL = prev;
  });

  it('factoría con REDIS_URL caído hace fallback a memoria', async () => {
    const prev = process.env.REDIS_URL;
    process.env.REDIS_URL = 'redis://127.0.0.1:6399';
    const { createJobQueue, __resetJobQueueSingleton } = await import('../packages/queue/dist/factory.js');
    __resetJobQueueSingleton();
    const q = await createJobQueue();
    assert.equal(q.kind, 'memory');
    await q.close();
    __resetJobQueueSingleton();
    if (prev !== undefined) process.env.REDIS_URL = prev;
    else delete process.env.REDIS_URL;
  });
});

describe('JobsService FASE 8 (API real)', async () => {
  const { JobsService } = await import('../apps/api/dist/jobs/jobs.service.js');
  const { InMemoryJobStore } = await import('../packages/storage/dist/memory-store.js');
  const { InMemoryJobQueue } = await import('../packages/queue/dist/memory-queue.js');

  const dto = (over = {}) => ({ url: 'https://shop.com/', instruction: 'Obtén productos', ...over });

  it('create persiste QUEUED y encola; results/execution/cancel', async () => {
    const service = new JobsService(new InMemoryJobStore(), new InMemoryJobQueue());
    const created = await service.create(dto({ ai: { provider: 'custom', model: 'm-local' } }));
    assert.equal(created.status, 'QUEUED');
    assert.equal(created.aiProvider, 'custom');

    const found = await service.findOne(created.id);
    assert.equal(found.url, 'https://shop.com/');

    const list = await service.list();
    assert.equal(list.length, 1);

    const empty = await service.results(created.id);
    assert.equal(empty.count, 0);

    const exec = await service.execution(created.id);
    assert.equal(exec.status, 'QUEUED');
    assert.deepEqual(exec.commands, []);

    const cancelled = await service.cancel(created.id);
    assert.equal(cancelled.status, 'CANCELLED');
    assert.equal(await service.findOne('job_missing'), null);
  });

  it('cancel encolado lo saca de la cola; enqueue fallido deja FAILED y lanza', async () => {
    const { InMemoryJobStore: S } = await import('../packages/storage/dist/memory-store.js');
    const store = new S();
    const queue = new InMemoryJobQueue();
    const service = new JobsService(store, queue);
    const created = await service.create(dto());
    assert.equal(await queue.pendingCount(), 1);
    await service.cancel(created.id);
    assert.equal(await queue.pendingCount(), 0);

    const badQueue = { kind: 'memory', queueName: 'x', remove: async () => false, pendingCount: async () => 0, close: async () => {}, enqueue: async () => { throw new Error('redis down'); } };
    const service2 = new JobsService(store, badQueue);
    await assert.rejects(() => service2.create(dto()), /no encolado/);
    const failed = (await store.listJobs(10)).find((j) => j.status === 'FAILED');
    assert.ok(failed, 'el job con enqueue fallido queda FAILED');
  });
});

describe('processJob del worker (FASE 7)', async () => {
  const { processJob } = await import('../apps/worker/dist/job-processor.js');
  const { AIOrchestrator } = await import('../packages/ai/dist/orchestrator/ai-orchestrator.js');
  const { ExecutionEngine } = await import('../packages/execution-engine/dist/execution-engine.js');
  const { InMemoryJobStore } = await import('../packages/storage/dist/memory-store.js');

  const plan = {
    version: '1.0',
    actions: [
      { type: 'NAVIGATE', url: 'https://tienda.com/p' },
      { type: 'EXTRACT_LIST', selector: '.product-card', fields: { name: '.name', price: '.price' } },
      { type: 'FINISH' },
    ],
  };
  const fake = {
    name: 'fake-llm',
    createPlan: async () => structuredClone(plan),
    analyzePage: async () => [{ type: 'FINISH' }],
    recover: async () => [{ type: 'FINISH' }],
    interpret: async (c) => c.rawItems,
    getLastStats: () => ({ latencyMs: 3, tokens: 7, model: 'fake-model', provider: 'fake-llm' }),
  };

  it('COMPLETED persiste plan, comandos, páginas, resultados e IA', async () => {
    const store = new InMemoryJobStore();
    const job = await store.createJob({ url: 'https://tienda.com/p', instruction: 'Obtén productos' });
    const res = await processJob(job.id, {
      store,
      createOrchestrator: () => new AIOrchestrator(fake),
      createEngine: () => new ExecutionEngine({ fetcher: async () => SHOP_HTML }),
    });
    assert.equal(res.status, 'COMPLETED');
    assert.equal((await store.getJob(job.id)).status, 'COMPLETED');
    assert.equal((await store.getCommands(job.id)).length, 3);
    assert.ok((await store.getPages(job.id)).length >= 1);
    const results = await store.getResults(job.id);
    assert.equal(results.length, 1);
    assert.equal(results[0].sourceUrl, 'https://tienda.com/p');
  });

  it('job inexistente lanza; CANCELLED no se procesa', async () => {
    const store = new InMemoryJobStore();
    await assert.rejects(() => processJob('job_missing', { store }), /no encontrado/);
    const job = await store.createJob({ url: 'https://t.com', instruction: 'x' });
    await store.updateStatus(job.id, 'CANCELLED');
    const res = await processJob(job.id, { store });
    assert.equal(res.status, 'FAILED');
    assert.match(res.error, /cancelado/);
  });

  it('idempotencia: reprocesar (retry) no duplica artefactos', async () => {
    const store = new InMemoryJobStore();
    const job = await store.createJob({ url: 'https://tienda.com/p', instruction: 'Obtén productos' });
    const deps = {
      store,
      createOrchestrator: () => new AIOrchestrator(fake),
      createEngine: () => new ExecutionEngine({ fetcher: async () => SHOP_HTML }),
    };
    await processJob(job.id, deps);
    assert.equal((await store.getCommands(job.id)).length, 3);
    // Segundo intento (simula retry BullMQ): limpia y vuelve a persistir → 3, no 6.
    await store.updateStatus(job.id, 'QUEUED');
    await processJob(job.id, deps);
    assert.equal((await store.getCommands(job.id)).length, 3);
    assert.equal((await store.getPages(job.id)).length, 1);
    assert.equal((await store.getResults(job.id)).length, 1);
  });

  it('clearJobArtifacts borra plan/comandos/páginas/resultados/errores', async () => {
    const store = new InMemoryJobStore();
    const job = await store.createJob({ url: 'https://x.com', instruction: 'x' });
    await store.savePlan(job.id, { version: '1.0', actions: [] });
    await store.saveCommand(job.id, 'FINISH', {}, 'OK');
    await store.savePage(job.id, 'https://x.com');
    await store.saveResults(job.id, [{ data: { a: 1 }, sourceUrl: 'https://x.com' }]);
    await store.saveError(job.id, 'prev');
    await store.clearJobArtifacts(job.id);
    assert.equal((await store.getCommands(job.id)).length, 0);
    assert.equal((await store.getPages(job.id)).length, 0);
    assert.equal((await store.getResults(job.id)).length, 0);
    assert.equal((await store.getErrors(job.id)).length, 0);
  });
});

describe('PrismaJobStore en PostgreSQL (solo con DATABASE_URL válido)', async () => {
  it('smoke CRUD si hay DB; si no, skip explícito', async () => {
    let PrismaClient;
    try {
      ({ PrismaClient } = await import('@prisma/client'));
    } catch {
      console.log('SKIP prisma: @prisma/client no disponible');
      return;
    }
    const url = process.env.DATABASE_URL;
    if (!url) {
      console.log('SKIP prisma: sin DATABASE_URL (levanta docker compose postgres)');
      return;
    }
    const client = new PrismaClient();
    const ok = await Promise.race([
      client.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      new Promise((r) => setTimeout(() => r(false), 4000)),
    ]);
    if (!ok) {
      console.log('SKIP prisma: DATABASE_URL no responde');
      await client.$disconnect().catch(() => undefined);
      return;
    }
    const { PrismaJobStore } = await import('../packages/storage/dist/prisma-store.js');
    const store = new PrismaJobStore(client);
    assert.equal(store.kind, 'prisma');
    const job = await store.createJob({ url: 'https://smoke.test/', instruction: 'smoke' });
    await store.saveResults(job.id, [{ data: { ok: true }, sourceUrl: job.url }]);
    assert.equal((await store.getResults(job.id)).length, 1);
    await store.updateStatus(job.id, 'COMPLETED');
    assert.equal((await store.getJob(job.id)).status, 'COMPLETED');
    await client.job.delete({ where: { id: job.id } });
    await client.$disconnect();
  });
});
