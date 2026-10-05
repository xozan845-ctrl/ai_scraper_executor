import { after, before, describe, it } from 'node:test';
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

    before(async () => {
      api = await startApi({ port: 3222, env: { API_KEYS: KEY }, healthTimeoutMs: 90_000 });
    });
    after(async () => {
      api?.stop();
      const { disconnectMongo } = await import('../packages/mongodb/dist/index.js');
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
      const mongo = await import('../packages/mongodb/dist/index.js');
      const models = await import('../packages/mongodb/dist/models.js');
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
  },
);
