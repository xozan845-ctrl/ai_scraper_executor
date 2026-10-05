import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Persistencia e idempotencia: limpieza de artefactos (incl. IA), ámbito de la
 * Idempotency-Key, cursor correcto y radiografía con timeout acotada.
 */
describe('Persistencia / idempotencia (ETAPA 8)', async () => {
  const { InMemoryJobStore } = await import('../packages/storage/dist/memory-store.js');
  const { InMemorySessionStore } = await import('../packages/storage/dist/session-store.js');
  const { InMemoryJobQueue } = await import('../packages/queue/dist/memory-queue.js');
  const { JobsService } = await import('../apps/api/dist/jobs/jobs.service.js');
  const { SessionsService } = await import('../apps/api/dist/jobs/sessions.service.js');

  const newService = () => new JobsService(new InMemoryJobStore(), new InMemoryJobQueue());

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
