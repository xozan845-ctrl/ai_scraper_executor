import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

describe('Casos de uso de ejecución', async () => {
  const { JobUseCases } = await import('../libs/application/execution/dist/index.js');
  const { UserUseCases } = await import('../libs/application/execution/dist/index.js');
  const { InMemoryJobStore } = await import('../libs/infrastructure/storage/dist/memory-store.js');
  const { InMemoryUserStore } = await import('../libs/infrastructure/storage/dist/user-store.js');
  const { InMemoryJobQueue } = await import('../libs/infrastructure/queue/dist/memory-queue.js');

  it('crea y encola jobs dentro del ámbito del propietario', async () => {
    const store = new InMemoryJobStore();
    const queue = new InMemoryJobQueue();
    const useCases = new JobUseCases(store, queue, { correlationId: () => 'corr-1' });
    const created = await useCases.create({
      url: 'https://example.com/', instruction: 'extraer título', priority: 2,
    }, undefined, undefined, 'owner-a');

    assert.equal(created.status, 'QUEUED');
    assert.equal(await useCases.findOne(created.id, 'owner-a')?.then((job) => job?.id), created.id);
    assert.equal(await useCases.findOne(created.id, 'owner-b'), null);
    assert.equal(await queue.pendingCount(), 1);
  });

  it('marca FAILED y guarda causa si el enqueue falla', async () => {
    const store = new InMemoryJobStore();
    const queue = {
      kind: 'memory', queueName: 'test', remove: async () => false,
      pendingCount: async () => 0, close: async () => {},
      enqueue: async () => { throw new Error('queue offline'); },
    };
    const useCases = new JobUseCases(store, queue);

    await assert.rejects(
      useCases.create({ url: 'https://example.com/', instruction: 'x' }),
      (error) => error.message.includes('Job creado pero no encolado: queue offline')
        && error.cause?.message === 'queue offline',
    );
    const rows = await store.listJobs(1);
    assert.equal(rows[0].status, 'FAILED');
    assert.match((await store.getErrors(rows[0].id))[0].message, /queue offline/);
  });

  it('cancelación elimina de cola y reintento limpia artefactos previos', async () => {
    const store = new InMemoryJobStore();
    const queue = new InMemoryJobQueue();
    const useCases = new JobUseCases(store, queue);
    const job = await useCases.create({ url: 'https://example.com/', instruction: 'x' });
    await useCases.cancel(job.id);
    assert.equal((await useCases.findOne(job.id)).status, 'CANCELLED');
    assert.equal(await queue.pendingCount(), 0);

    await store.updateStatus(job.id, 'FAILED');
    await store.saveError(job.id, 'fallo previo');
    await useCases.retry(job.id);
    assert.equal((await useCases.findOne(job.id)).status, 'QUEUED');
    assert.equal((await store.getErrors(job.id)).length, 0);
    assert.equal(await queue.pendingCount(), 1);
  });

  it('normaliza usuarios y permite un único bootstrap con API key hasheada', async () => {
    const store = new InMemoryUserStore();
    const users = new UserUseCases(store);
    const apiKey = 'sk-test-bootstrap';
    const hash = (value) => createHash('sha256').update(value).digest('hex');
    const registered = await users.registerFirst({ email: 'Admin@Example.com', password: 'secret' }, {
      hashPassword: async (password) => `hash:${password}`,
      generateApiKey: () => apiKey,
      hashApiKey: hash,
    });

    assert.equal(registered.user.email, 'admin@example.com');
    assert.equal(registered.user.role, 'superadmin');
    assert.equal(registered.apiKey, apiKey);
    assert.equal(await users.verifyApiKey(apiKey), true);
    await assert.rejects(users.registerFirst({ email: 'second@example.com', password: 'secret' }, {
      hashPassword: async (password) => `hash:${password}`,
      generateApiKey: () => 'sk-second',
      hashApiKey: hash,
    }), /registro inicial está cerrado/);
  });

  it('crea usuarios regulares y busca por email sin distinguir mayúsculas', async () => {
    const users = new UserUseCases(new InMemoryUserStore());
    const created = await users.createUser({
      email: ' User@Example.com ', passwordHash: 'stored-hash', role: 'user', apiKeyHash: null,
    });
    assert.equal(created.email, 'user@example.com');
    assert.deepEqual(await users.findByEmail('USER@example.com'), {
      email: 'user@example.com', role: 'user',
    });
    assert.equal(await users.countUsers(), 1);
  });
});
