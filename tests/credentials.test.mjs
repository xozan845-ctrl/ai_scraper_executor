import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

describe('Credenciales (headers) en el motor (Etapa B)', async () => {
  const { ExecutionEngine } = await import('../packages/execution-engine/dist/execution-engine.js');
  let server;
  let base;

  before(async () => {
    process.env.ALLOW_PRIVATE_HOSTS = '1';
    await new Promise((resolve) => {
      server = http
        .createServer((req, res) => {
          res.setHeader('content-type', 'text/html');
          res.end(`<!doctype html><html><body><span id="auth">${req.headers.authorization ?? 'none'}</span></body></html>`);
        })
        .listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => new Promise((r) => server.close(r)));

  it('inyecta headers (Authorization) en el fetch HTTP', async () => {
    const engine = new ExecutionEngine({ headers: { Authorization: 'Bearer secret' } });
    await engine.execute({ type: 'NAVIGATE', url: base + '/' });
    const r = await engine.execute({ type: 'EXTRACT', fields: { auth: '#auth' } });
    assert.equal(r.items[0].auth.value, 'Bearer secret');
  });

  it('sin headers no envía Authorization', async () => {
    const engine = new ExecutionEngine();
    await engine.execute({ type: 'NAVIGATE', url: base + '/' });
    const r = await engine.execute({ type: 'EXTRACT', fields: { auth: '#auth' } });
    assert.equal(r.items[0].auth.value, 'none');
  });
});
