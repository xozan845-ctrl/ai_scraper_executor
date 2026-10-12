import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

/**
 * Persistencia e idempotencia: limpieza de artefactos (incl. IA), ámbito de la
 * Idempotency-Key, cursor correcto y radiografía con timeout acotada.
 */
describe('Persistencia / idempotencia (ETAPA 8)', async () => {
  const { InMemoryJobStore } = await import('../libs/infrastructure/storage/dist/memory-store.js');
  const { InMemorySessionStore } = await import('../libs/infrastructure/storage/dist/session-store.js');
  const { InMemoryJobQueue } = await import('../libs/infrastructure/queue/dist/memory-queue.js');
  const { JobsService } = await import('../apps/api/dist/jobs/jobs.service.js');
  const { SessionsService } = await import('../apps/api/dist/jobs/sessions.service.js');

  const newService = () => new JobsService(new InMemoryJobStore(), new InMemoryJobQueue());

  it('retry deja el job en FAILED y registra el error cuando no puede reenviarlo', async () => {
    const store = new InMemoryJobStore();
    const queue = {
      kind: 'memory',
      enqueue: async () => { throw new Error('Redis no disponible'); },
      remove: async () => true,
      pendingCount: async () => 0,
      close: async () => {},
    };
    const service = new JobsService(store, queue);
    const job = await store.createJob({ url: 'https://shop.com/', instruction: 'x' });
    await store.saveCommand(job.id, 'FINISH', { type: 'FINISH' }, 'OK');
    await store.updateStatus(job.id, 'FAILED');

    await assert.rejects(() => service.retry(job.id), /Reencolado fallido: Redis no disponible/);

    assert.equal((await store.getJob(job.id)).status, 'FAILED');
    assert.equal((await store.getCommands(job.id)).length, 0, 'el reintento no conserva artefactos previos');
    const errors = await store.getErrors(job.id);
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /Reencolado fallido: Redis no disponible/);
  });

  it('retry vuelve a poner en cola un job fallido tras limpiar sus artefactos', async () => {
    const store = new InMemoryJobStore();
    const queue = new InMemoryJobQueue();
    const service = new JobsService(store, queue);
    const job = await store.createJob({ url: 'https://shop.com/', instruction: 'x' });
    await store.saveCommand(job.id, 'FINISH', { type: 'FINISH' }, 'OK');
    await store.updateStatus(job.id, 'FAILED');

    const retried = await service.retry(job.id);

    assert.equal(retried.status, 'QUEUED');
    assert.equal((await store.getCommands(job.id)).length, 0, 'el nuevo intento empieza sin artefactos previos');
    assert.equal(await queue.pendingCount(), 1, 'el job queda disponible para un worker');
  });

  it('retry elimina la entrada fallida antes de reutilizar su jobId', async () => {
    const store = new InMemoryJobStore();
    let staleEntryExists = true;
    const queue = {
      kind: 'bullmq',
      enqueue: async (payload) => {
        assert.equal(staleEntryExists, false, 'BullMQ no admite reutilizar un jobId que sigue en cola');
        return { id: payload.jobId };
      },
      remove: async () => {
        staleEntryExists = false;
        return true;
      },
      pendingCount: async () => 0,
      close: async () => {},
    };
    const service = new JobsService(store, queue);
    const job = await store.createJob({ url: 'https://shop.com/', instruction: 'x' });
    await store.updateStatus(job.id, 'FAILED');

    const retried = await service.retry(job.id);

    assert.equal(retried.status, 'QUEUED');
  });

  it('clearJobArtifacts elimina también las interacciones IA (reintentos limpios)', async () => {
    const store = new InMemoryJobStore();
    const job = await store.createJob({ url: 'https://x.com/', instruction: 'i' });
    await store.saveAIInteraction(job.id, { provider: 'p', kind: 'run', tokens: 10 });
    assert.equal((await store.getAIInteractions(job.id)).length, 1);
    await store.clearJobArtifacts(job.id);
    assert.equal((await store.getAIInteractions(job.id)).length, 0);
  });

  it('Idempotency-Key tiene ámbito: misma clave+scope reutiliza, distinto scope no', async () => {
    const service = newService();
    const a1 = await service.create({ url: 'https://shop.com/', instruction: 'x' }, 'k1', undefined, 'scopeA');
    const a2 = await service.create({ url: 'https://shop.com/', instruction: 'x' }, 'k1', undefined, 'scopeA');
    assert.equal(a2.id, a1.id, 'misma clave y scope → mismo job');
    const b = await service.create({ url: 'https://shop.com/', instruction: 'x' }, 'k1', undefined, 'scopeB');
    assert.notEqual(b.id, a1.id, 'misma clave, distinto scope → job distinto');
  });

  it('list devuelve nextCursor solo si hay más páginas', async () => {
    const service = newService();
    for (let i = 0; i < 3; i += 1) {
      await service.create({ url: `https://shop.com/p${i}`, instruction: 'x' });
    }
    const page1 = await service.list(2);
    assert.equal(page1.items.length, 2);
    assert.ok(page1.nextCursor, 'hay más páginas');
    const page2 = await service.list(2, { cursor: page1.nextCursor });
    assert.equal(page2.items.length, 1);
    assert.equal(page2.nextCursor, null, 'última página sin cursor');
  });

  it('radiografía que no termina → FAILED por timeout (no queda colgada)', async () => {
    process.env.RADIOGRAPHY_TIMEOUT_MS = '50';
    try {
      const sessions = new InMemorySessionStore();
      const jobs = newService();
      const svc = new SessionsService(sessions, jobs, () => new Promise(() => {}));
      const s = await svc.create({ url: 'https://shop.com/' });
      const start = Date.now();
      let status = 'RADIOGRAPHY';
      while (Date.now() - start < 2000) {
        status = (await svc.status(s.id)).status;
        if (status === 'FAILED') break;
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.equal(status, 'FAILED');
      assert.match((await svc.status(s.id)).error, /no completada/);
    } finally {
      delete process.env.RADIOGRAPHY_TIMEOUT_MS;
    }
  });
});
