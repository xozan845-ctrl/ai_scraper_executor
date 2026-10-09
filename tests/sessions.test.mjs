import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

async function waitFor(fn, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
}

describe('Sesiones tipo chat (Etapa A)', async () => {
  const { InMemorySessionStore } = await import('../libs/infrastructure/storage/dist/session-store.js');
  const { InMemoryJobStore } = await import('../libs/infrastructure/storage/dist/memory-store.js');
  const { InMemoryJobQueue } = await import('../libs/infrastructure/queue/dist/memory-queue.js');
  const { JobsService } = await import('../apps/api/dist/jobs/jobs.service.js');
  const { SessionsService } = await import('../apps/api/dist/jobs/sessions.service.js');
  const { encryptJson, decryptJson } = await import('../libs/shared/security/dist/crypto.js');

  function makeService(radiographer = async () => {}) {
    const sessions = new InMemorySessionStore();
    const jobs = new JobsService(new InMemoryJobStore(), new InMemoryJobQueue());
    return { sessions, svc: new SessionsService(sessions, jobs, radiographer) };
  }

  it('SessionStore: CRUD + mensajes', async () => {
    const store = new InMemorySessionStore();
    const s = await store.createSession({ url: 'https://x.com', domain: 'x.com' });
    assert.equal(s.status, 'RADIOGRAPHY');
    await store.updateSessionStatus(s.id, 'READY');
    assert.equal((await store.getSession(s.id)).status, 'READY');
    await store.addMessage(s.id, 'user', 'hola');
    await store.addMessage(s.id, 'assistant', 'ok', 'job_1');
    const msgs = await store.getMessages(s.id);
    assert.equal(msgs.length, 2);
    assert.equal(msgs[1].jobId, 'job_1');
    assert.equal((await store.listSessions()).length, 1);
  });

  it('cifrado de credenciales round-trip (IV distinto)', async () => {
    process.env.CREDENTIALS_KEY = 'a'.repeat(64);
    const value = { headers: { Authorization: 'Bearer x' } };
    const c1 = encryptJson(value);
    const c2 = encryptJson(value);
    assert.notEqual(c1, c2);
    assert.deepEqual(decryptJson(c1), value);
    delete process.env.CREDENTIALS_KEY;
  });

  it('create lanza radiografía y pasa a READY (input desbloqueado)', async () => {
    let radiated = false;
    const { svc } = makeService(async () => { radiated = true; });
    const s = await svc.create({ url: 'https://shop.com/' });
    assert.equal(s.status, 'RADIOGRAPHY');
    assert.ok(await waitFor(async () => (await svc.status(s.id)).status === 'READY'));
    assert.ok(radiated);
    assert.equal((await svc.list()).length, 1);
  });

  it('sendMessage bloqueado hasta READY; luego crea job + 2 mensajes', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const { sessions, svc } = makeService(async () => { await gate; });
    const s = await svc.create({ url: 'https://shop.com/' });
    await assert.rejects(() => svc.sendMessage(s.id, { instruction: 'productos' }), /no está lista/);
    release();
    await waitFor(async () => (await svc.status(s.id)).status === 'READY');
    const r = await svc.sendMessage(s.id, { instruction: 'productos' });
    assert.ok(r.jobId);
    const detail = await svc.get(s.id);
    assert.equal(detail.messages.length, 2);
    assert.equal(detail.messages[0].role, 'user');
    assert.equal(detail.messages[1].role, 'assistant');
    assert.equal(detail.messages[1].jobId, r.jobId);
    assert.equal(detail.messages[1].jobStatus, 'QUEUED', 'historial enriquecido con estado del job');
    void sessions;
  });

  it('credenciales: exige CREDENTIALS_KEY y no las expone en la vista', async () => {
    delete process.env.CREDENTIALS_KEY;
    const { sessions, svc } = makeService();
    await assert.rejects(
      () => svc.create({ url: 'https://shop.com/', credentials: { headers: { Authorization: 'x' } } }),
      /CREDENTIALS_KEY/,
    );
    process.env.CREDENTIALS_KEY = 'c'.repeat(64);
    const s = await svc.create({ url: 'https://shop.com/', credentials: { headers: { Authorization: 'Bearer y' } } });
    assert.equal(s.credentials, undefined, 'la vista no expone credenciales');
    const stored = await sessions.getSession(s.id);
    assert.ok(stored.credentials.includes('.'), 'guardadas cifradas');
    delete process.env.CREDENTIALS_KEY;
  });
});
