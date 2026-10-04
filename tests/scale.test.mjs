import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Escala FASE 11 ETAPA 6 (prioridades + caché + dedupe)', async () => {
  const { InMemoryJobQueue } = await import('../packages/queue/dist/memory-queue.js');
  const { normalizePriority } = await import('../packages/queue/dist/types.js');
  const { ExecutionEngine, PageCache, normalizeUrlForDedupe } = await import('../packages/execution-engine/dist/index.js');

  it('normalizePriority acota a 1..10 con defecto 5', () => {
    assert.equal(normalizePriority(undefined), 5);
    assert.equal(normalizePriority('x'), 5);
    assert.equal(normalizePriority(0), 1);
    assert.equal(normalizePriority(1), 1);
    assert.equal(normalizePriority(10), 10);
    assert.equal(normalizePriority(99), 10);
  });

  it('drain respeta prioridad (1 primero) y FIFO ante empate', async () => {
    const q = new InMemoryJobQueue();
    const mk = (jobId, priority) => ({ jobId, url: 'https://x.com/', instruction: 'i', ...(priority !== undefined ? { priority } : {}) });
    await q.enqueue(mk('low', 9));
    await q.enqueue(mk('high', 1));
    await q.enqueue(mk('mid', 5));
    await q.enqueue(mk('tie-a', 5));
    await q.enqueue(mk('tie-b', 5));
    const order = [];
    await q.drain(async (p) => void order.push(p.jobId));
    assert.deepEqual(order, ['high', 'mid', 'tie-a', 'tie-b', 'low']);
  });

  it('JobsService propaga priority al enqueue', async () => {
    const { JobsService } = await import('../apps/api/dist/jobs/jobs.service.js');
    const { InMemoryJobStore } = await import('../packages/storage/dist/memory-store.js');
    const store = new InMemoryJobStore();
    let seen;
    const queue = new InMemoryJobQueue();
    const orig = queue.enqueue.bind(queue);
    queue.enqueue = async (p) => {
      seen = p;
      return orig(p);
    };
    const service = new JobsService(store, queue);
    await service.create({ url: 'https://shop.com/', instruction: 'Obtén productos', priority: 2 });
    assert.equal(seen.priority, 2);
  });

  it('PageCache evita refetch y expone hits/misses', async () => {
    let calls = 0;
    const engine = new ExecutionEngine({ fetcher: async () => `html-${++calls}` });
    await engine.execute({ type: 'NAVIGATE', url: 'https://tienda.com/p' });
    await engine.execute({ type: 'NAVIGATE', url: 'https://tienda.com/p' });
    assert.equal(calls, 1);
    const stats = engine.getCacheStats();
    assert.equal(stats.hits, 1);
    assert.equal(stats.misses, 1);
    assert.equal(stats.size, 1);
  });

  it('normalizeUrlForDedupe colapsa /p, /p/ y /p#frag', () => {
    assert.equal(
      normalizeUrlForDedupe('https://Tienda.com/p/', undefined),
      normalizeUrlForDedupe('https://tienda.com/p#frag', undefined),
    );
    assert.notEqual(
      normalizeUrlForDedupe('https://tienda.com/p1'),
      normalizeUrlForDedupe('https://tienda.com/p2'),
    );
  });

  it('FOLLOW_LINKS deduplica variantes de la misma URL', async () => {
    const html = `<!doctype html><html><head><title>T</title></head><body>
      <a class="l" href="/p">a</a><a class="l" href="/p/">b</a><a class="l" href="/p#frag">c</a>
    </body></html>`;
    let fetches = 0;
    const engine = new ExecutionEngine({
      fetcher: async (url) => {
        fetches += 1;
        return url.includes('/p') ? html : html;
      },
    });
    await engine.execute({ type: 'NAVIGATE', url: 'https://tienda.com/inicio' });
    const before = fetches;
    const r = await engine.execute({ type: 'FOLLOW_LINKS', selector: '.l', maxLinks: 10 });
    assert.equal(r.ok, true);
    // 1 NAVIGATE + 1 fetch único para las 3 variantes
    assert.equal(fetches, before + 1);
    assert.equal(r.count, 1);
  });

  it('PageCache compartida entre engines evita refetch cross-job', async () => {
    const shared = new PageCache({ ttlMs: 60_000, maxEntries: 10 });
    let fetches = 0;
    const fetcher = async () => `html-${++fetches}`;
    const e1 = new ExecutionEngine({ fetcher, pageCache: shared });
    const e2 = new ExecutionEngine({ fetcher, pageCache: shared });
    await e1.execute({ type: 'NAVIGATE', url: 'https://tienda.com/shared' });
    await e2.execute({ type: 'NAVIGATE', url: 'https://tienda.com/shared' });
    assert.equal(fetches, 1);
  });
});
