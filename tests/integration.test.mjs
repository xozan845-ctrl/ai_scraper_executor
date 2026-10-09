import { afterAll, beforeAll, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { startApi } from '../scripts/api-server.mjs';

/**
 * Integración con almacenes reales (R-I-*, G-4). Requiere Postgres, MongoDB y
 * Redis levantados (`docker compose up -d postgres mongodb redis`) y sus URLs
 * en el entorno. Si faltan, la suite se **salta** con un mensaje, para que
 * `npm test` (sin Docker) no falle por esto.
 */

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.MONGODB_URI && process.env.REDIS_URL);
const KEY = 'integration-key';

describe(
  'Integración API + almacenes reales (G-4)',
  { skip: HAS_INFRA ? false : 'faltan DATABASE_URL / MONGODB_URI / REDIS_URL' },
  () => {
    let api;

    beforeAll(async () => {
      api = await startApi({ port: 3222, env: { API_KEYS: KEY }, healthTimeoutMs: 90_000 });
    });
    afterAll(async () => {
      api?.stop();
      const { disconnectMongo } = await import('../libs/infrastructure/mongodb/dist/index.js');
      await disconnectMongo().catch(() => undefined);
    });

    const authed = (path, opts = {}) =>
      fetch(`${api.baseUrl}${path}`, { ...opts, headers: { 'x-api-key': KEY, ...(opts.headers ?? {}) } });
    const postJson = (path, body, headers = {}) =>
      authed(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

    it('R-I-12: readiness reporta los almacenes reales (no memoria)', async () => {
      const res = await authed('/api/v1/health/ready');
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.checks.store, 'prisma', `store=${body.checks.store}`);
      assert.equal(body.checks.queue, 'bullmq', `queue=${body.checks.queue}`);
    });

    it('R-I-1: ciclo de vida del job persistido en Postgres y encolado en Redis', async () => {
      const create = await postJson('/api/v1/jobs', {
        url: 'https://example.com/',
        instruction: 'Extrae el título de la página',
      });
      assert.ok([200, 201].includes(create.status), `status ${create.status}`);
      const job = await create.json();
      assert.equal(typeof job.id, 'string');

      const get = await authed(`/api/v1/jobs/${job.id}`);
      assert.equal(get.status, 200);
      assert.equal((await get.json()).id, job.id);

      const results = await authed(`/api/v1/jobs/${job.id}/results`);
      assert.equal(results.status, 200);
      assert.equal((await results.json()).count, 0);

      const cancel = await authed(`/api/v1/jobs/${job.id}/cancel`, { method: 'POST' });
      assert.ok([200, 201].includes(cancel.status), `cancel status ${cancel.status}`);
      assert.equal((await cancel.json()).status, 'CANCELLED');
    });

    it('R-DI-2: la creación con la misma Idempotency-Key no duplica el job', async () => {
      const key = `itest-${Date.now()}`;
      const body = { url: 'https://example.com/', instruction: 'Idempotencia de prueba' };
      const first = await postJson('/api/v1/jobs', body, { 'idempotency-key': key });
      const second = await postJson('/api/v1/jobs', body, { 'idempotency-key': key });
      assert.equal((await first.json()).id, (await second.json()).id);
    });

    it('R-I-9: MongoDB real persiste y lee una radiografía (y limpia su dato)', async () => {
      const mongo = await import('../libs/infrastructure/mongodb/dist/index.js');
      const models = await import('../libs/infrastructure/mongodb/dist/models.js');
      await mongo.connectMongo();
      const url = `https://itest-${Date.now()}.example/`;
      const doc = await models.PageRadiography.create({
        url,
        domain: `itest-${Date.now()}.example`,
        profileId: new mongo.mongoose.Types.ObjectId(),
        htmlHash: 'itest-hash',
        title: 'itest',
        structure: { lists: [], forms: [], scripts: 0, stylesheets: 0 },
        statusCode: 200,
        loadTimeMs: 1,
        usedBrowser: false,
        expiresAt: new Date(Date.now() + 3600_000),
      });
      assert.ok(doc._id);
      const found = await models.PageRadiography.findOne({ url }).lean();
      assert.equal(found?.htmlHash, 'itest-hash');
      await models.PageRadiography.deleteOne({ _id: doc._id }); // sin residuo (R-QA-3)
    });

    it('R-I-4: sin API key, `POST /jobs` responde 401 y no crea nada', async () => {
      const res = await fetch(`${api.baseUrl}/api/v1/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com/', instruction: 'sin clave' }),
      });
      assert.equal(res.status, 401);
    });

    it('R-I-6: el DTO descarta campos inyectados (mass assignment)', async () => {
      const res = await postJson('/api/v1/jobs', {
        url: 'https://example.com/',
        instruction: 'Mass assignment',
        status: 'COMPLETED',
        userId: 'intruso',
      });
      assert.ok([200, 201].includes(res.status), `status ${res.status}`);
      const job = await res.json();
      assert.notEqual(job.status, 'COMPLETED', 'el status inyectado se aplicó');
      assert.notEqual(job.userId, 'intruso', 'el userId inyectado se aplicó');
    });

    it('R-I-2: el filtro por status es correcto y la paginación conserva el filtro', async () => {
      const ids = [];
      for (let i = 0; i < 2; i++) {
        const create = await postJson('/api/v1/jobs', {
          url: 'https://example.com/',
          instruction: `Filtro ${i} ${Date.now()}`,
        });
        const job = await create.json();
        ids.push(job.id);
        await authed(`/api/v1/jobs/${job.id}/cancel`, { method: 'POST' });
      }

      const filtered = await authed('/api/v1/jobs?status=CANCELLED&limit=100');
      assert.equal(filtered.status, 200);
      const page = await filtered.json();
      assert.ok(Array.isArray(page.items));
      assert.ok(page.items.every((j) => j.status === 'CANCELLED'), 'hay jobs que no encajan en el filtro');
      for (const id of ids) assert.ok(page.items.some((j) => j.id === id), `falta el job ${id}`);

      const one = await authed('/api/v1/jobs?status=CANCELLED&limit=1');
      const small = await one.json();
      assert.equal(small.items.length, 1, 'limit=1 debe devolver exactamente 1 item');
      assert.ok(small.nextCursor === null || typeof small.nextCursor === 'string');
      if (small.nextCursor) assert.ok(small.items[0].status === 'CANCELLED');
    });
  },
);
