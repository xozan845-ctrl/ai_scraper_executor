import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

const {
  createSessionUseCases,
  JobUrlRejectedError,
  SessionCredentialsUnavailableError,
  SessionNotReadyError,
} = await import('../libs/application/execution/dist/index.js');

async function waitFor(fn, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

class FakeSessionStore {
  constructor() {
    this.kind = 'memory';
    this.seq = 0;
    this.sessions = new Map();
    this.messages = new Map();
  }

  stamp() {
    return new Date().toISOString();
  }

  async createSession(input) {
    const record = {
      id: `ses_${++this.seq}`,
      status: 'RADIOGRAPHY',
      error: null,
      createdAt: this.stamp(),
      updatedAt: this.stamp(),
      ...input,
    };
    this.sessions.set(record.id, record);
    this.messages.set(record.id, []);
    return record;
  }

  async getSession(id, scope) {
    const session = this.sessions.get(id);
    return session && (!scope || session.ownerScope === scope) ? session : null;
  }

  async listSessions(limit = 100, scope) {
    return [...this.sessions.values()]
      .filter((session) => !scope || session.ownerScope === scope)
      .slice(0, limit);
  }

  async updateSessionStatus(id, status, error = null) {
    const session = this.sessions.get(id);
    if (!session) return null;
    const updated = { ...session, status, error, updatedAt: this.stamp() };
    this.sessions.set(id, updated);
    return updated;
  }

  async addMessage(sessionId, role, content, jobId = null) {
    const message = {
      id: `msg_${++this.seq}`,
      sessionId,
      role,
      content,
      jobId,
      createdAt: this.stamp(),
    };
    this.messages.get(sessionId).push(message);
    return message;
  }

  async getMessages(sessionId) {
    return [...(this.messages.get(sessionId) ?? [])];
  }
}

function setup(overrides = {}) {
  const sessions = new FakeSessionStore();
  const jobs = {
    created: [],
    resultItems: [{ name: 'Producto' }],
    async createJob(input) {
      const job = { id: `job_${this.created.length + 1}`, status: 'QUEUED' };
      this.created.push({ input, job });
      return job;
    },
    async getJob(id) {
      const entry = this.created.find((row) => row.job.id === id);
      return entry ? { status: entry.job.status } : null;
    },
    async getResults() {
      return { items: this.resultItems };
    },
  };
  const radiography = { calls: [], run: async (url) => { radiography.calls.push(url); } };
  const credentials = { enabled: true, encrypt: (value) => `enc:${JSON.stringify(value)}` };
  const profileReader = {
    getSummary: async (url) => ({
      domain: 'shop.com',
      isJavaScriptHeavy: false,
      selectors: { list: ['.card'], detail: [], pagination: null },
      stats: { totalJobs: 2, successfulJobs: 1 },
      url,
    }),
  };
  const urlPolicy = { allowedDomains: ['shop.com'], allowPrivateHosts: false };
  const useCases = createSessionUseCases({
    sessions,
    jobs,
    radiography,
    profileReader,
    credentials: { isEnabled: () => credentials.enabled, encrypt: credentials.encrypt },
    urlPolicy,
    radiographyConcurrency: 1,
    ...overrides,
  });
  return { sessions, jobs, radiography, credentials, useCases };
}

describe('F8 — casos de uso de sesiones con dobles de puertos', () => {
  it('create valida URL, cifra credenciales y lanza radiografía hasta READY', async () => {
    const { sessions, radiography, credentials, useCases } = setup();
    const view = await useCases.create.execute({
      url: 'https://shop.com/',
      credentials: { headers: { Authorization: 'Bearer x' } },
      scope: 'scope-a',
    });

    assert.equal(view.status, 'RADIOGRAPHY');
    assert.equal(view.credentials, undefined);
    const stored = await sessions.getSession(view.id, 'scope-a');
    assert.match(stored.credentials, /^enc:/);
    assert.deepEqual(radiography.calls, ['https://shop.com/']);
    assert.ok(await waitFor(async () => (await useCases.queries.status(view.id, 'scope-a')).status === 'READY'));
    void credentials;
  });

  it('rechaza credenciales sin clave y URLs inválidas/fuera de allowlist', async () => {
    const { sessions, useCases } = setup({ credentials: { isEnabled: () => false, encrypt: () => 'x' } });
    await assert.rejects(
      () => useCases.create.execute({ url: 'https://shop.com/', credentials: { headers: { A: 'b' } } }),
      (error) => error instanceof SessionCredentialsUnavailableError,
    );
    await assert.rejects(
      () => useCases.create.execute({ url: 'ftp://shop.com/x' }),
      (error) => error instanceof JobUrlRejectedError && error.reason === 'invalid',
    );
    await assert.rejects(
      () => useCases.create.execute({ url: 'https://other.com/' }),
      (error) => error instanceof JobUrlRejectedError && error.reason === 'domain',
    );
    assert.equal(sessions.sessions.size, 0);
  });

  it('un fallo de radiografía deja la sesión FAILED con el error', async () => {
    const { useCases } = setup({
      radiography: { run: async () => { throw new Error('sin navegador'); } },
    });
    const view = await useCases.create.execute({ url: 'https://shop.com/' });
    assert.ok(await waitFor(async () => (await useCases.queries.status(view.id, 'anon')).status === 'FAILED'));
    const status = await useCases.queries.status(view.id, 'anon');
    assert.match(status.error, /sin navegador/);
  });

  it('sendMessage exige READY, crea job y dos mensajes', async () => {
    const { jobs, useCases } = setup();
    const view = await useCases.create.execute({ url: 'https://shop.com/', scope: 's1' });

    await assert.rejects(
      () => useCases.sendMessage.execute({ sessionId: view.id, instruction: 'productos', scope: 's1' }),
      (error) => error instanceof SessionNotReadyError,
    );
    await waitFor(async () => (await useCases.queries.status(view.id, 's1')).status === 'READY');
    const result = await useCases.sendMessage.execute({ sessionId: view.id, instruction: 'productos', scope: 's1' });

    assert.equal(result.jobId, jobs.created[0].job.id);
    assert.deepEqual(jobs.created[0].input, {
      url: 'https://shop.com/',
      instruction: 'productos',
      sessionId: view.id,
      scope: 's1',
    });
    const detail = await useCases.queries.get(view.id, 's1');
    assert.equal(detail.messages.length, 2);
    assert.equal(detail.messages[1].role, 'assistant');
    assert.equal(detail.messages[1].jobStatus, 'QUEUED');
    assert.deepEqual(detail.messages[1].results, [{ name: 'Producto' }]);
    assert.deepEqual(detail.profile.selectors, { list: ['.card'], detail: [], pagination: null });
    assert.equal(await useCases.sendMessage.execute({ sessionId: view.id, instruction: 'x', scope: 'otro' }), null);
  });

  it('reconcilia una radiografía colgada y aísla listado por scope', async () => {
    const { sessions, useCases } = setup();
    const own = await useCases.create.execute({ url: 'https://shop.com/', scope: 's1' });
    await waitFor(async () => (await useCases.queries.status(own.id, 's1')).status === 'READY');
    await useCases.create.execute({ url: 'https://shop.com/otra', scope: 's2' });

    const stale = sessions.sessions.get(own.id);
    sessions.sessions.set(own.id, { ...stale, status: 'RADIOGRAPHY', updatedAt: '2000-01-01T00:00:00.000Z' });
    const status = await useCases.queries.status(own.id, 's1');
    assert.equal(status.status, 'FAILED');

    const list = await useCases.queries.list('s1');
    assert.equal(list.length, 1);
    assert.equal(list[0].id, own.id);
  });
});
