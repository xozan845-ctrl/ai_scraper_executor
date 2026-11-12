import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

const {
  createJobUseCases,
  JobEnqueueError,
  JobUrlRejectedError,
} = await import('../libs/application/execution/dist/index.js');

class FakeStore {
  constructor() {
    this.kind = 'memory';
    this.seq = 0;
    this.jobs = new Map();
    this.idempotency = new Map();
    this.errors = [];
    this.results = new Map();
    this.commands = new Map();
    this.pages = new Map();
    this.aiCalls = new Map();
    this.cleared = [];
  }

  now() {
    return new Date().toISOString();
  }

  async createJob(input) {
    const record = {
      id: `job_${++this.seq}`,
      status: 'QUEUED',
      createdAt: this.now(),
      updatedAt: this.now(),
      ...input,
    };
    this.jobs.set(record.id, record);
    return record;
  }

  async getOrCreateJob(input, idempotencyKey) {
    const existing = this.idempotency.get(idempotencyKey);
    if (existing) return { record: this.jobs.get(existing), created: false };
    const record = await this.createJob(input);
    this.idempotency.set(idempotencyKey, record.id);
    return { record, created: true };
  }

  async getJob(id) {
    return this.jobs.get(id) ?? null;
  }

  async listJobs(limit = 20, options = {}) {
    let rows = [...this.jobs.values()];
    if (options.ownerScope) rows = rows.filter((job) => job.ownerScope === options.ownerScope);
    if (options.status) rows = rows.filter((job) => job.status === options.status);
    return rows.slice(0, limit);
  }

  async updateStatus(id, status) {
    const job = this.jobs.get(id);
    if (!job) return null;
    const updated = { ...job, status, updatedAt: this.now() };
    this.jobs.set(id, updated);
    return updated;
  }

  async saveError(id, message) {
    this.errors.push({ id, message });
  }

  async clearJobArtifacts(id) {
    this.cleared.push(id);
  }

  async getResults(id) {
    return this.results.get(id) ?? [];
  }

  async getCommands(id) {
    return this.commands.get(id) ?? [];
  }

  async getPages(id) {
    return this.pages.get(id) ?? [];
  }

  async getErrors(id) {
    return this.errors.filter((row) => row.id === id);
  }

  async getAIInteractions(id) {
    return this.aiCalls.get(id) ?? [];
  }

  async getStats() {
    return {
      jobsTotal: this.jobs.size,
      jobsByStatus: {},
      resultsTotal: 0,
      commandsTotal: 0,
      commandsRecovered: 0,
      pagesTotal: 0,
      errorsTotal: this.errors.length,
      aiCallsTotal: 0,
      aiTokensTotal: 0,
    };
  }
}

class FakeQueue {
  constructor() {
    this.kind = 'memory';
    this.payloads = [];
    this.removed = [];
    this.fail = false;
  }

  async enqueue(payload) {
    if (this.fail) throw new Error('cola caída');
    this.payloads.push(payload);
    return { id: payload.jobId };
  }

  async remove(id) {
    this.removed.push(id);
    return true;
  }

  async pendingCount() {
    return this.payloads.length;
  }

  async close() {}
}

function setup(overrides = {}) {
  const store = new FakeStore();
  const queue = new FakeQueue();
  const metrics = { counts: {}, inc(name) { this.counts[name] = (this.counts[name] ?? 0) + 1; } };
  const policy = { allowedDomains: [], allowPrivateHosts: false, ...overrides.policy };
  const useCases = createJobUseCases({ store, queue, metrics, policy });
  return { store, queue, metrics, useCases };
}

const command = (extra = {}) => ({
  url: 'https://shop.com/products',
  instruction: 'Obtén productos',
  scope: 'scope-a',
  ...extra,
});

describe('F8 — casos de uso de jobs con dobles de puertos', () => {
  it('CreateJob valida, persiste, encola y proyecta sin ownerScope', async () => {
    const { store, queue, metrics, useCases } = setup();
    const view = await useCases.create.execute(command({
      priority: 3,
      correlationId: 'corr-1',
      ai: { provider: 'custom', model: 'm1' },
      render: { mode: 'always', waitForSelector: 'app-root', waitUntil: 'networkidle' },
    }));

    assert.equal(view.ownerScope, undefined);
    assert.equal(view.status, 'QUEUED');
    assert.deepEqual(view.render, { mode: 'always', waitForSelector: 'app-root', waitUntil: 'networkidle' });
    assert.equal(store.jobs.get(view.id).ownerScope, 'scope-a');
    assert.equal(queue.payloads.length, 1);
    assert.deepEqual(queue.payloads[0], {
      jobId: view.id,
      url: 'https://shop.com/products',
      instruction: 'Obtén productos',
      limits: undefined,
      ai: { provider: 'custom', model: 'm1' },
      priority: 3,
      correlationId: 'corr-1',
    });
    assert.equal(metrics.counts.jobs_created_total, 1);
  });

  it('rechaza URL inválida o dominio fuera de allowlist sin persistir', async () => {
    const { store, queue, useCases } = setup({ policy: { allowedDomains: ['example.com'] } });

    await assert.rejects(
      () => useCases.create.execute(command({ url: 'ftp://shop.com/x' })),
      (error) => error instanceof JobUrlRejectedError && error.reason === 'invalid',
    );
    await assert.rejects(
      () => useCases.create.execute(command({ url: 'https://shop.com/x' })),
      (error) => error instanceof JobUrlRejectedError && error.reason === 'domain',
    );
    assert.equal(store.jobs.size, 0);
    assert.equal(queue.payloads.length, 0);
  });

  it('idempotencia por ámbito: misma clave+scope reutiliza, distinto scope no', async () => {
    const { queue, useCases } = setup();
    const first = await useCases.create.execute(command({ idempotencyKey: 'k1' }));
    const again = await useCases.create.execute(command({ idempotencyKey: 'k1' }));
    const otherScope = await useCases.create.execute(command({ idempotencyKey: 'k1', scope: 'scope-b' }));

    assert.equal(again.id, first.id);
    assert.notEqual(otherScope.id, first.id);
    assert.equal(queue.payloads.length, 2);
  });

  it('si la cola falla, el job queda FAILED con error y no se silencia', async () => {
    const { store, queue, useCases } = setup();
    queue.fail = true;

    await assert.rejects(
      () => useCases.create.execute(command()),
      (error) => error instanceof JobEnqueueError && /no encolado/.test(error.message),
    );
    const [record] = [...store.jobs.values()];
    assert.equal(record.status, 'FAILED');
    assert.match(store.errors.at(-1).message, /Enqueue fallido/);
  });

  it('Cancel: no-op en estado terminal y CANCELLED en el resto', async () => {
    const { store, queue, metrics, useCases } = setup();
    const job = await useCases.create.execute(command());

    const cancelled = await useCases.cancel.execute(job.id, 'scope-a');
    assert.equal(cancelled.status, 'CANCELLED');
    assert.deepEqual(queue.removed, [job.id]);
    assert.equal(metrics.counts.jobs_cancelled_total, 1);

    await store.updateStatus(job.id, 'COMPLETED');
    const terminal = await useCases.cancel.execute(job.id, 'scope-a');
    assert.equal(terminal.status, 'COMPLETED');
    assert.equal(metrics.counts.jobs_cancelled_total, 1);
    assert.equal(await useCases.cancel.execute(job.id, 'otro'), null);
  });

  it('Retry: limpia artefactos, reencola y respeta ownership', async () => {
    const { store, queue, metrics, useCases } = setup();
    const job = await useCases.create.execute(command());

    await store.updateStatus(job.id, 'FAILED');
    const retried = await useCases.retry.execute(job.id, 'scope-a', 'corr-2');
    assert.equal(retried.status, 'QUEUED');
    assert.deepEqual(store.cleared, [job.id]);
    assert.equal(queue.payloads.at(-1).correlationId, 'corr-2');
    assert.equal(metrics.counts.jobs_retried_total, 1);

    const noop = await useCases.retry.execute(job.id, 'scope-a');
    assert.equal(noop.status, 'QUEUED');
    assert.equal(queue.payloads.length, 2);
    assert.equal(await useCases.retry.execute(job.id, 'otro'), null);
  });

  it('Retry: un fallo de cola deja FAILED y lanza JobEnqueueError', async () => {
    const { store, queue, useCases } = setup();
    const job = await useCases.create.execute(command());
    await store.updateStatus(job.id, 'FAILED');
    queue.fail = true;

    await assert.rejects(
      () => useCases.retry.execute(job.id, 'scope-a'),
      (error) => error instanceof JobEnqueueError && /Reencolado fallido/.test(error.message),
    );
    assert.equal(store.jobs.get(job.id).status, 'FAILED');
  });

  it('Queries: ownership, paginación, results con _source y aiInteractions', async () => {
    const { store, useCases } = setup();
    const first = await useCases.create.execute(command());
    const second = await useCases.create.execute(command({ url: 'https://shop.com/p2' }));
    const third = await useCases.create.execute(command({ url: 'https://shop.com/p3' }));

    assert.equal(await useCases.queries.findOne(first.id, 'otro'), null);
    assert.equal((await useCases.queries.findOne(first.id, 'scope-a')).ownerScope, undefined);

    const page = await useCases.queries.list(2, {}, 'scope-a');
    assert.equal(page.items.length, 2);
    assert.equal(page.nextCursor, page.items.at(-1).id);

    store.results.set(first.id, [{
      id: 'r1',
      data: { name: 'Producto', _source: { scrapedAt: 'x' } },
      sourceUrl: 'https://shop.com/products',
      selector: '.card',
      createdAt: '2026-01-01T00:00:00.000Z',
    }]);
    const results = await useCases.queries.results(first.id, 'scope-a');
    assert.equal(results.count, 1);
    assert.equal(results.items[0]._source.url, 'https://shop.com/products');
    assert.equal(results.items[0]._source.selector, '.card');
    assert.equal(results.items[0]._source.scrapedAt, 'x');

    store.aiCalls.set(second.id, [
      { id: 'a1', provider: 'openrouter', kind: 'plan', createdAt: 'x' },
      { id: 'a2', provider: 'openrouter', kind: 'plan', createdAt: 'x' },
      { id: 'a3', provider: 'openrouter', kind: 'plan', createdAt: 'x' },
    ]);
    const ai = await useCases.queries.aiInteractions(second.id, 2, 'scope-a');
    assert.equal(ai.count, 2);
    assert.deepEqual(ai.calls.map((call) => call.id), ['a2', 'a3']);
    assert.equal(await useCases.queries.aiInteractions(third.id, 2, 'otro'), null);
  });
});
