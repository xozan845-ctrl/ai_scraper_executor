import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';

const {
  createApiKeyUseCases,
  ApiKeyValidationError,
} = await import('../libs/application/execution/dist/index.js');
const { createApiKeyRepository } = await import('../libs/infrastructure/storage/dist/index.js');
const { ApiKeyGuard } = await import('../apps/api/dist/jobs/api-key.guard.js');
const { AdminGuard } = await import('../apps/api/dist/jobs/admin.guard.js');

function guardContext(req) {
  return { switchToHttp: () => ({ getRequest: () => req }) };
}

function setup() {
  const repository = createApiKeyRepository();
  return { repository, useCases: createApiKeyUseCases({ repository }) };
}

describe('API keys de cliente', () => {
  const OLD_ENV = { ...process.env };
  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    delete process.env.API_KEYS;
  });
  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it('genera una clave mostrada una sola vez y guarda solo el hash', async () => {
    const { repository, useCases } = setup();
    const generated = await useCases.generate.execute({ name: 'Cliente Acme' });

    assert.match(generated.apiKey, /^sk-.{22}$/);
    assert.equal(generated.record.name, 'Cliente Acme');
    assert.equal(generated.record.role, 'user');
    assert.equal(generated.record.prefix, generated.apiKey.slice(0, 12));
    assert.equal('keyHash' in generated.record, false);

    const listed = await useCases.list.execute();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, generated.record.id);

    const auth = await useCases.authenticate.execute(generated.apiKey);
    assert.deepEqual(auth, { id: generated.record.id, role: 'user', name: 'Cliente Acme' });
    assert.equal(await useCases.authenticate.execute('sk-inventada'), null);
    void repository;
  });

  it('valida el nombre y revoca claves', async () => {
    const { useCases } = setup();
    await assert.rejects(() => useCases.generate.execute({ name: 'a' }), ApiKeyValidationError);

    const generated = await useCases.generate.execute({ name: 'Cliente' });
    assert.equal(await useCases.revoke.execute(generated.record.id), true);
    assert.equal(await useCases.revoke.execute(generated.record.id), false);
    assert.equal(await useCases.authenticate.execute(generated.apiKey), null);
    const [row] = await useCases.list.execute();
    assert.ok(row.revokedAt);
  });

  it('ApiKeyGuard distingue admin de cliente y AdminGuard bloquea al cliente', async () => {
    process.env.API_KEYS = 'admin-secret';
    const { useCases } = setup();
    const client = await useCases.generate.execute({ name: 'Cliente' });
    const guard = new ApiKeyGuard(undefined, useCases);

    const adminReq = { headers: { 'x-api-key': 'admin-secret' } };
    assert.equal(await guard.canActivate(guardContext(adminReq)), true);
    assert.equal(adminReq.authRole, 'superadmin');

    const clientReq = { headers: { 'x-api-key': client.apiKey } };
    assert.equal(await guard.canActivate(guardContext(clientReq)), true);
    assert.equal(clientReq.authRole, 'user');
    assert.equal(clientReq.authKeyId, client.record.id);

    const adminGuard = new AdminGuard();
    assert.equal(adminGuard.canActivate(guardContext(adminReq)), true);
    assert.throws(() => adminGuard.canActivate(guardContext(clientReq)), (error) => error.getStatus() === 403);
    await assert.rejects(
      () => guard.canActivate(guardContext({ headers: { 'x-api-key': 'sk-mala' } })),
      /API key inválida/,
    );
  });

  it('en dev sin API_KEYS el guard abre como superadmin para poder gestionar claves', async () => {
    const guard = new ApiKeyGuard();
    const req = { headers: {} };
    assert.equal(await guard.canActivate(guardContext(req)), true);
    assert.equal(req.authRole, 'superadmin');
    assert.equal(req.authScope, 'anon');
  });
});
