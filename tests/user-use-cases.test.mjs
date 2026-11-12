import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

const {
  createUserUseCases,
  generateApiKey,
  hashApiKey,
  UserAlreadyExistsError,
} = await import('../libs/application/execution/dist/index.js');

function setup() {
  const users = [];
  const logins = [];
  const repository = {
    async countUsers() {
      return users.length;
    },
    async createUser(data) {
      const user = { ...data, createdAt: new Date() };
      users.push(user);
      return { email: user.email, role: user.role, createdAt: user.createdAt };
    },
    async createFirstUser(data) {
      if (users.length > 0) throw new UserAlreadyExistsError();
      const user = { ...data, role: 'superadmin', createdAt: new Date() };
      users.push(user);
      return { email: user.email, role: user.role, createdAt: user.createdAt };
    },
    async findByEmail(email) {
      const found = users.find((user) => user.email === email);
      return found ? { email: found.email, role: found.role } : null;
    },
    async existsApiKeyHash(hash) {
      return users.some((user) => user.apiKeyHash === hash);
    },
    async recordLogin(email) {
      logins.push(email);
    },
  };
  return { users, logins, useCases: createUserUseCases({ repository }) };
}

describe('F8 — casos de uso de usuarios y API keys', () => {
  it('createFirstUser normaliza email y cierra el bootstrap tras el primero', async () => {
    const { users, useCases } = setup();
    const first = await useCases.createFirstUser({
      email: '  Admin@X.com ',
      passwordHash: 'hash',
      apiKeyHash: hashApiKey('sk-1'),
    });
    assert.equal(first.email, 'admin@x.com');
    assert.equal(first.role, 'superadmin');
    assert.equal(users.length, 1);

    await assert.rejects(
      () => useCases.createFirstUser({ email: 'b@x.com', passwordHash: 'h', apiKeyHash: hashApiKey('sk-2') }),
      UserAlreadyExistsError,
    );
  });

  it('verifyApiKey compara hashes y nunca acepta vacío', async () => {
    const { useCases } = setup();
    await useCases.createUser({
      email: 'a@x.com',
      passwordHash: 'h',
      role: 'user',
      apiKeyHash: hashApiKey('sk-secret'),
    });
    assert.equal(await useCases.verifyApiKey('sk-secret'), true);
    assert.equal(await useCases.verifyApiKey('sk-otro'), false);
    assert.equal(await useCases.verifyApiKey(''), false);
  });

  it('genera API keys con formato y sin colisiones prácticas', () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateApiKey()));
    assert.equal(keys.size, 50);
    for (const key of keys) assert.match(key, /^sk-.{22}$/);
  });

  it('findByEmail y recordLogin normalizan el email', async () => {
    const { logins, useCases } = setup();
    await useCases.createUser({ email: 'MiXeD@X.com', passwordHash: 'h', role: 'user', apiKeyHash: null });
    assert.deepEqual(await useCases.findByEmail('  MIXED@x.com '), { email: 'mixed@x.com', role: 'user' });
    await useCases.recordLogin(' MiXeD@X.com ');
    assert.deepEqual(logins, ['mixed@x.com']);
  });
});
