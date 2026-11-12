import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

const {
  createJobUseCases,
  createScheduleCrudUseCases,
  createScheduleUseCases,
  ScheduleValidationError,
} = await import('../libs/application/execution/dist/index.js');
const { createScheduleStore, InMemoryJobStore } = await import('../libs/infrastructure/storage/dist/index.js');
const { InMemoryJobQueue } = await import('../libs/infrastructure/queue/dist/memory-queue.js');
const { SchedulesService } = await import('../apps/api/dist/jobs/schedules.service.js');

const policy = { allowedDomains: [], allowPrivateHosts: false };

function setup() {
  const store = createScheduleStore();
  const jobStore = new InMemoryJobStore();
  const queue = new InMemoryJobQueue();
  const jobUseCases = createJobUseCases({ store: jobStore, queue, policy });
  const held = new Set();
  const lock = {
    async acquire(key) {
      if (held.has(key)) return false;
      held.add(key);
      return true;
    },
    async release(key) { held.delete(key); },
  };
  let now = 1_000_000;
  const useCases = createScheduleUseCases({
    store,
    createJob: jobUseCases.create,
    lock,
    policy,
    now: () => now,
  });
  return {
    store,
    jobStore,
    queue,
    held,
    lock,
    useCases,
    jobUseCases,
    setNow: (value) => { now = value; },
  };
}

const command = (extra = {}) => ({
  url: 'https://shop.com/',
  instruction: 'productos',
  intervalSec: 60,
  scope: 'scope-a',
  ...extra,
});

describe('N2 — jobs programados por intervalo', () => {
  it('crea el schedule con nextRunAt y valida intervalo/URLs', async () => {
    const { useCases } = setup();
    const view = await useCases.create.execute(command({ maxRuns: 2, webhookUrl: 'https://hooks.example.com/x' }));
    assert.equal(view.intervalSec, 60);
    assert.equal(view.nextRunAt, new Date(1_000_000 + 60_000).toISOString());
    assert.equal(view.status, 'ACTIVE');
    assert.equal(view.runCount, 0);

    await assert.rejects(
      () => useCases.create.execute(command({ intervalSec: 5 })),
      ScheduleValidationError,
    );
    await assert.rejects(
      () => useCases.create.execute(command({ maxRuns: 0 })),
      ScheduleValidationError,
    );
    await assert.rejects(
      () => useCases.create.execute(command({ webhookUrl: 'http://127.0.0.1/hook' })),
      /Webhook URL rechazada/,
    );
  });

  it('consulta con ownership y controla pausa/reanudación/borrado', async () => {
    const { useCases } = setup();
    const view = await useCases.create.execute(command());

    assert.equal(await useCases.queries.findOne(view.id, 'otro'), null);
    assert.equal((await useCases.queries.findOne(view.id, 'scope-a')).id, view.id);
    assert.equal((await useCases.queries.list(undefined, 'scope-a')).length, 1);

    const paused = await useCases.control.pause(view.id, 'scope-a');
    assert.equal(paused.status, 'PAUSED');
    const resumed = await useCases.control.resume(view.id, 'scope-a');
    assert.equal(resumed.status, 'ACTIVE');
    assert.equal(resumed.nextRunAt, new Date(1_000_000 + 60_000).toISOString());

    assert.equal(await useCases.control.remove(view.id, 'otro'), false);
    assert.equal(await useCases.control.remove(view.id, 'scope-a'), true);
    assert.equal(await useCases.queries.findOne(view.id, 'scope-a'), null);
  });

  it('runDue crea y encola el job, avanza nextRunAt y cierra al llegar a maxRuns', async () => {
    const { useCases, jobStore, queue, setNow } = setup();
    const view = await useCases.create.execute(command({ maxRuns: 1 }));

    setNow(1_060_000);
    const result = await useCases.runDue.execute();
    assert.deepEqual(result, { run: 1, failed: 0, skipped: 0 });

    const jobs = await jobStore.listJobs(10, { ownerScope: 'scope-a' });
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].url, 'https://shop.com/');
    assert.equal(await queue.pendingCount(), 1);

    const updated = await useCases.queries.findOne(view.id, 'scope-a');
    assert.equal(updated.runCount, 1);
    assert.equal(updated.status, 'COMPLETED');
    assert.equal(updated.lastJobId, jobs[0].id);
    assert.equal(updated.nextRunAt, new Date(1_060_000 + 60_000).toISOString());
  });

  it('runDue respeta el lock y registra fallos sin tumbar el bucle', async () => {
    const { useCases, held, setNow } = setup();
    const view = await useCases.create.execute(command());
    held.add(`schedule:${view.id}`);

    setNow(1_060_000);
    assert.deepEqual(await useCases.runDue.execute(), { run: 0, failed: 0, skipped: 1 });
    held.delete(`schedule:${view.id}`);

    policy.allowedDomains = ['otro.com'];
    const result = await useCases.runDue.execute();
    assert.deepEqual(result, { run: 0, failed: 1, skipped: 0 });
    const updated = await useCases.queries.findOne(view.id, 'scope-a');
    assert.match(updated.lastError, /Dominio no permitido/);
    policy.allowedDomains = [];
  });

  it('SchedulesService mapea validación a 400 y conserva CRUD', async () => {
    const store = createScheduleStore();
    const service = new SchedulesService(createScheduleCrudUseCases({ store, policy }));
    const created = await service.create({
      url: 'https://shop.com/',
      instruction: 'productos',
      intervalSec: 120,
    });
    assert.equal(created.intervalSec, 120);
    assert.equal((await service.list()).length, 1);
    assert.equal((await service.get(created.id)).id, created.id);
    assert.equal((await service.pause(created.id)).status, 'PAUSED');
    assert.equal((await service.resume(created.id)).status, 'ACTIVE');
    assert.equal(await service.remove(created.id), true);

    await assert.rejects(
      () => service.create({ url: 'https://shop.com/', instruction: 'x', intervalSec: 1 }),
      (error) => error.getStatus() === 400,
    );
  });
});
