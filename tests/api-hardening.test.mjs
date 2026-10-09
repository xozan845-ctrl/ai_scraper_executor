import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const ctx = (req) => ({ switchToHttp: () => ({ getRequest: () => req }) });

describe('API hardening ETAPA 4 (auth + allowlist + rate-limit + ai paging)', async () => {
  const { JobsService } = await import('../apps/api/dist/jobs/jobs.service.js');
  const { ApiKeyGuard, isAuthEnforced } = await import('../apps/api/dist/jobs/api-key.guard.js');
  const { CreateRateLimitGuard } = await import('../apps/api/dist/jobs/rate-limit.guard.js');
  const { InMemoryJobStore } = await import('../libs/infrastructure/storage/dist/memory-store.js');
  const { InMemoryJobQueue } = await import('../libs/infrastructure/queue/dist/memory-queue.js');

  const OLD_ENV = { ...process.env };
  beforeEach(() => {
    delete process.env.API_KEYS;
    delete process.env.ALLOWED_DOMAINS;
    delete process.env.RATE_LIMIT_CREATE_PER_MIN;
  });
  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it('create rechaza SSRF y no persiste el job', async () => {
    const store = new InMemoryJobStore();
    const service = new JobsService(store, new InMemoryJobQueue());
    await assert.rejects(
      () => service.create({ url: 'http://169.254.169.254/latest', instruction: 'Obtén x' }),
      /URL rechazada/,
    );
    await assert.rejects(
      () => service.create({ url: 'http://127.0.0.1/admin', instruction: 'Obtén x' }),
      /URL rechazada/,
    );
    assert.equal((await store.listJobs(10)).length, 0);
  });

  it('ALLOWED_DOMAINS restringe el alta por job', async () => {
    process.env.ALLOWED_DOMAINS = 'tienda.com';
    const store = new InMemoryJobStore();
    const service = new JobsService(store, new InMemoryJobQueue());
    const ok = await service.create({ url: 'https://sub.tienda.com/p', instruction: 'Obtén productos' });
    assert.equal(ok.status, 'QUEUED');
    await assert.rejects(
      () => service.create({ url: 'https://evil.com/p', instruction: 'Obtén productos' }),
      /Dominio no permitido/,
    );
  });

  it('ApiKeyGuard: abierto sin API_KEYS, estricto con claves', async () => {
    assert.equal(isAuthEnforced(), false);
    assert.equal(await new ApiKeyGuard().canActivate(ctx({ headers: {}, query: {} })), true);

    process.env.API_KEYS = 'k1,k2';
    assert.equal(isAuthEnforced(), true);
    const guard = new ApiKeyGuard();
    await assert.rejects(() => guard.canActivate(ctx({ headers: {}, query: {} })), /API key/);
    await assert.rejects(() => guard.canActivate(ctx({ headers: { 'x-api-key': 'wrong' }, query: {} })), /API key/);
    const authorized = { headers: { 'x-api-key': 'k2' }, query: {} };
    assert.equal(await guard.canActivate(ctx(authorized)), true);
    assert.match(authorized.authScope, /^[a-f0-9]{64}$/);
    // La clave por query string YA NO se acepta (fuga en logs/Referer).
    await assert.rejects(() => guard.canActivate(ctx({ headers: {}, query: { apiKey: 'k1' } })), /API key/);
  });

  it('ApiKeyGuard fail-closed en producción sin claves', async () => {
    const prevNode = process.env.NODE_ENV;
    const prevKeys = process.env.API_KEYS;
    delete process.env.API_KEYS;
    process.env.NODE_ENV = 'production';
    assert.equal(isAuthEnforced(), true);
    await assert.rejects(() => new ApiKeyGuard().canActivate(ctx({ headers: {}, query: {} })), /API_KEYS/);
    if (prevNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNode;
    if (prevKeys !== undefined) process.env.API_KEYS = prevKeys;
  });

  it('CreateRateLimitGuard: permite N y rechaza N+1 por IP (limiter inyectado)', async () => {
    const { MemoryRateLimiter } = await import('../libs/infrastructure/redis/dist/ratelimit.js');
    const limiter = new MemoryRateLimiter({ max: 2, windowMs: 60_000 });
    const guard = new CreateRateLimitGuard({ max: 2, windowMs: 60_000, limiter });
    const ip = ctx({ ip: '1.2.3.4' });
    assert.equal(await guard.canActivate(ip), true);
    assert.equal(await guard.canActivate(ip), true);
    await assert.rejects(() => guard.canActivate(ip), /Rate limit/);
    // Otra IP tiene su propio bucket
    assert.equal(await guard.canActivate(ctx({ ip: '5.6.7.8' })), true);
  });

  it('aiInteractions pagina con limit', async () => {
    const store = new InMemoryJobStore();
    const service = new JobsService(store, new InMemoryJobQueue());
    const created = await service.create({ url: 'https://shop.com/', instruction: 'Obtén productos' });
    for (let i = 0; i < 5; i += 1) {
      await store.saveAIInteraction(created.id, { provider: 'p', kind: 'plan', tokens: 1 });
    }
    const all = await service.aiInteractions(created.id);
    assert.equal(all.count, 5);
    const page = await service.aiInteractions(created.id, 2);
    assert.equal(page.count, 2);
    assert.equal(await service.aiInteractions('job_missing'), null);
  });
});
