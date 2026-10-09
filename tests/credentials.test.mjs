import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

describe('Credenciales (headers) en el motor (Etapa B)', async () => {
  const { ExecutionEngine } = await import('../libs/infrastructure/execution/dist/execution-engine.js');
  let server;
  let redirectTarget;
  let base;

  before(async () => {
    process.env.ALLOW_PRIVATE_HOSTS = '1';
    await new Promise((resolve) => {
      redirectTarget = http
        .createServer((req, res) => {
          res.setHeader('content-type', 'text/html');
          res.end(`<!doctype html><html><body><span id="auth">${req.headers.authorization ?? 'none'}</span></body></html>`);
        })
        .listen(0, '127.0.0.1', resolve);
    });
    await new Promise((resolve) => {
      server = http
        .createServer((req, res) => {
          if (req.url === '/redirect') {
            res.statusCode = 302;
            res.setHeader('location', `http://127.0.0.1:${redirectTarget.address().port}/sink`);
            res.end();
            return;
          }
          if (req.url === '/large') {
            res.setHeader('content-type', 'text/html');
            res.write('x'.repeat(64));
            res.end('y'.repeat(64));
            return;
          }
          res.setHeader('content-type', 'text/html');
          res.end(`<!doctype html><html><body><span id="auth">${req.headers.authorization ?? 'none'}</span></body></html>`);
        })
        .listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((r) => server.close(r));
    await new Promise((r) => redirectTarget.close(r));
  });

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

  it('no reenvía credenciales cuando un redirect cambia de origin', async () => {
    const engine = new ExecutionEngine({ headers: { Authorization: 'Bearer secret' } });
    const nav = await engine.execute({ type: 'NAVIGATE', url: base + '/redirect' });
    assert.equal(nav.ok, true);
    const r = await engine.execute({ type: 'EXTRACT', fields: { auth: '#auth' } });
    assert.equal(r.items[0].auth.value, 'none');
  });

  it('corta el body durante streaming al superar maxBytes', async () => {
    const { safeFetchText } = await import('../libs/shared/security/dist/index.js');
    await assert.rejects(() => safeFetchText(base + '/large', { maxBytes: 80 }), /demasiado grande/);
  });
});
