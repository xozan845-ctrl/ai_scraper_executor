import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';

/**
 * Registro del primer superadmin (bootstrap) + API key de BD.
 * Se usa un UserService falso en memoria para no depender de Mongo.
 */
describe('first-user + API key de BD (seguridad)', async () => {
  const { FirstUserController } = await import('../apps/api/dist/jobs/first-user.controller.js');
  const { FirstRunGuard } = await import('../apps/api/dist/jobs/first-run.guard.js');
  const { ApiKeyGuard } = await import('../apps/api/dist/jobs/api-key.guard.js');
  const { hashApiKey } = await import('../apps/api/dist/jobs/user.service.js');

  const OLD_ENV = { ...process.env };
  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    delete process.env.API_KEYS;
    delete process.env.FIRST_RUN_TOKEN;
    process.env.BCRYPT_ROUNDS = '4';
  });
  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  function fakeUserService() {
    const users = [];
    return {
      users,
      countUsers: async () => users.length,
      createUser: async (data) => {
        const email = String(data.email).trim().toLowerCase();
        const u = { email, role: data.role, passwordHash: data.passwordHash, apiKeyHash: data.apiKeyHash, createdAt: new Date() };
        users.push(u);
        return { email: u.email, role: u.role, createdAt: u.createdAt };
      },
      createFirstUser: async (data) => {
        if (users.length > 0) {
          const error = new Error('Ya existe un usuario');
          error.getStatus = () => 409;
          throw error;
        }
        const email = String(data.email).trim().toLowerCase();
        const u = { email, role: 'superadmin', passwordHash: data.passwordHash, apiKeyHash: data.apiKeyHash, createdAt: new Date() };
        users.push(u);
        return { email: u.email, role: u.role, createdAt: u.createdAt };
      },
      generateApiKey: () => 'sk-test-1234567890abcdef',
      verifyApiKey: async (presented) => users.some((u) => u.apiKeyHash === hashApiKey(presented)),
    };
  }

  const guardCtx = (req) => ({ switchToHttp: () => ({ getRequest: () => req }) });

  it('registro con BD vacía: crea superadmin, guarda hash (no la clave en claro)', async () => {
    const svc = fakeUserService();
    const ctrl = new FirstUserController(svc);
    const res = await ctrl.registerFirst({ email: 'Admin@X.com', password: 'clave-segura' });

    assert.equal(res.role, 'superadmin');
    assert.equal(res.email, 'admin@x.com');
    assert.match(res.apiKey, /^sk-/);
    assert.equal(svc.users.length, 1);
    assert.equal(svc.users[0].apiKeyHash, hashApiKey(res.apiKey));
    assert.notEqual(svc.users[0].apiKeyHash, res.apiKey, 'nunca se guarda la clave en claro');
    assert.notEqual(svc.users[0].passwordHash, 'clave-segura', 'la contraseña va hasheada');
  });

  it('segundo registro → 409 (sin force)', async () => {
    const svc = fakeUserService();
    const ctrl = new FirstUserController(svc);
    await ctrl.registerFirst({ email: 'a@x.com', password: 'clave-segura' });
    await assert.rejects(
      () => ctrl.registerFirst({ email: 'b@x.com', password: 'clave-segura' }),
      (e) => e.getStatus() === 409,
    );
  });

  it('dos registros concurrentes crean exactamente un superadmin', async () => {
    const svc = fakeUserService();
    const ctrl = new FirstUserController(svc);
    const outcomes = await Promise.allSettled([
      ctrl.registerFirst({ email: 'a@x.com', password: 'clave-segura' }),
      ctrl.registerFirst({ email: 'b@x.com', password: 'clave-segura' }),
    ]);
    assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter((result) => result.status === 'rejected').length, 1);
    assert.equal(svc.users.length, 1);
  });

  it('FirstRunGuard: en dev/test no bloquea; en producción sin token → 403 (fail-closed)', () => {
    const guard = new FirstRunGuard();
    process.env.NODE_ENV = 'development';
    assert.equal(guard.canActivate(guardCtx({ headers: {} })), true);

    process.env.NODE_ENV = 'production';
    assert.throws(
      () => guard.canActivate(guardCtx({ headers: { 'x-first-run': 'x' } })),
      (e) => e.getStatus() === 403,
    );
  });

  it('FirstRunGuard: producción con token (header incorrecto/ausente → 401, correcto → true)', () => {
    process.env.NODE_ENV = 'production';
    process.env.FIRST_RUN_TOKEN = 'bootstrap-token';
    const guard = new FirstRunGuard();
    assert.throws(
      () => guard.canActivate(guardCtx({ headers: { 'x-first-run': 'malo' } })),
      (e) => e.getStatus() === 401,
    );
    assert.throws(
      () => guard.canActivate(guardCtx({ headers: {} })),
      (e) => e.getStatus() === 401,
    );
    assert.equal(guard.canActivate(guardCtx({ headers: { 'x-first-run': 'bootstrap-token' } })), true);
  });

  it('ApiKeyGuard acepta la API key de BD en producción sin API_KEYS', async () => {
    process.env.NODE_ENV = 'production';
    const svc = fakeUserService();
    await svc.createUser({ email: 'a@x.com', passwordHash: 'h', role: 'superadmin', apiKeyHash: hashApiKey('sk-db-key') });
    const guard = new ApiKeyGuard(svc);
    const ctx = (req2) => ({ switchToHttp: () => ({ getRequest: () => req2 }) });

    assert.equal(await guard.canActivate(ctx({ headers: { 'x-api-key': 'sk-db-key' } })), true);
    await assert.rejects(() => guard.canActivate(ctx({ headers: { 'x-api-key': 'sk-wrong' } })), /API_KEYS/);
    await assert.rejects(() => guard.canActivate(ctx({ headers: {} })), /API_KEYS/);
  });
});
