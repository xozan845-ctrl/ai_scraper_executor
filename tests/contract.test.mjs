import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startApi } from '../scripts/api-server.mjs';

/**
 * Contrato de la API (R-C-*, G-5): arranca la API compilada y valida la forma
 * real de las respuestas de `/api/v1/**`. No toca infraestructura externa
 * (los almacenes caen a memoria), así que es un gate de PR ligero.
 */

const KEY = 'contract-key';
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

describe('Contrato de la API (R-C-*)', () => {
  let api;

  before(async () => {
    api = await startApi({ port: 3221, env: { API_KEYS: KEY } });
  });
  after(() => api?.stop());

  const req = (path, opts = {}) => fetch(`${api.baseUrl}${path}`, opts);
  const authed = (path, opts = {}) =>
    req(path, { ...opts, headers: { 'x-api-key': KEY, ...(opts.headers ?? {}) } });
  const postJson = (path, body) =>
    authed(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('R-C-1: todo cuelga de /api/v1 (health y docs bajo el prefijo)', async () => {
    assert.equal((await req('/api/v1/health')).status, 200);
    assert.equal((await req('/api/v1/docs-json')).status, 200);
  });

  it('R-C-7: las fechas son ISO 8601 UTC con Z', async () => {
    const body = await (await req('/api/v1/health')).json();
    assert.match(body.time, ISO_Z);
  });

  it('R-C-9: los errores llevan statusCode y no exponen stack', async () => {
    assert.equal((await req('/api/v1/jobs/nope')).status, 401); // sin clave
    const r = await authed('/api/v1/jobs/does-not-exist');
    assert.equal(r.status, 404);
    const body = await r.json();
    assert.equal(body.statusCode, 404);
    assert.ok(!('stack' in body));
  });

  it('R-SE-10: el 401 no revela cuál clave falló', async () => {
    const r = await req('/api/v1/metrics');
    assert.equal(r.status, 401);
    const text = JSON.stringify(await r.json());
    assert.ok(!text.includes(KEY), 'el cuerpo filtró la clave');
  });

  it('R-DS-4: el DTO rechaza un payload inválido (400)', async () => {
    const r = await postJson('/api/v1/jobs', { url: 'no-es-url' });
    assert.equal(r.status, 400);
  });

  it('R-C-4/R-C-5: POST /jobs devuelve un DTO estable y GET lo recupera', async () => {
    const create = await postJson('/api/v1/jobs', {
      url: 'https://example.com/',
      instruction: 'Extrae el título de la página',
    });
    assert.ok([200, 201].includes(create.status), `status inesperado: ${create.status}`);
    const job = await create.json();
    assert.equal(typeof job.id, 'string');
    assert.equal(typeof job.status, 'string');
    assert.match(job.createdAt, ISO_Z);

    const get = await authed(`/api/v1/jobs/${job.id}`);
    assert.equal(get.status, 200);
    assert.equal((await get.json()).id, job.id);
  });

  it('R-DB-5: la lista trae { items, nextCursor }', async () => {
    const r = await authed('/api/v1/jobs?limit=5');
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok(Array.isArray(body.items));
    assert.ok(body.nextCursor === null || typeof body.nextCursor === 'string');
  });

  it('R-C-2: la spec OpenAPI declara los endpoints bajo el prefijo', async () => {
    const spec = await (await req('/api/v1/docs-json')).json();
    assert.ok(spec.openapi, 'sin campo openapi');
    assert.ok(spec.paths['/api/v1/jobs'], 'falta /api/v1/jobs en la spec');
  });

  it('R-TM-4: las peticiones HTTP se instrumentan (métricas RED)', async () => {
    await req('/api/v1/health');
    const res = await authed('/api/v1/metrics/prometheus');
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('scraper_http_requests_total'), 'falta scraper_http_requests_total');
    assert.ok(text.includes('scraper_http_request_duration_ms_total'), 'falta la duración');
  });
});
