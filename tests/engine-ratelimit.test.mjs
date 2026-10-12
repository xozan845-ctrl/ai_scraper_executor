import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

const SHOP_HTML = `<!doctype html><html><head><title>Tienda</title></head><body>
<div class="product-card"><span class="name">A</span></div>
</body></html>`;

describe('H — rate limit por host en el motor (bloque 4)', async () => {
  const { ExecutionEngine } = await import('../libs/infrastructure/execution/dist/execution-engine.js');

  it('consume un token por host antes de cada fetch real, no en cache hit', async () => {
    const hosts = [];
    const engine = new ExecutionEngine({
      fetcher: async () => SHOP_HTML,
      allowedDomain: 'tienda.com',
      rateLimit: async (host) => {
        hosts.push(host);
      },
    });
    await engine.execute({ type: 'NAVIGATE', url: 'https://a.tienda.com/1' });
    await engine.execute({ type: 'NAVIGATE', url: 'https://b.tienda.com/2' });
    await engine.execute({ type: 'NAVIGATE', url: 'https://a.tienda.com/1' });
    assert.deepEqual(hosts, ['a.tienda.com', 'b.tienda.com']);
  });

  it('un fallo del limitador no rompe el scraping', async () => {
    const engine = new ExecutionEngine({
      fetcher: async () => SHOP_HTML,
      rateLimit: async () => {
        throw new Error('redis caído');
      },
    });
    const r = await engine.execute({ type: 'NAVIGATE', url: 'https://tienda.com/x' });
    assert.equal(r.ok, true);
  });

  it('la señal de aborto se propaga desde el limitador', async () => {
    const controller = new AbortController();
    const engine = new ExecutionEngine({
      fetcher: async () => SHOP_HTML,
      signal: controller.signal,
      rateLimit: async () => {
        controller.abort(new Error('deadline agotado'));
        throw controller.signal.reason;
      },
    });
    await assert.rejects(
      () => engine.execute({ type: 'NAVIGATE', url: 'https://tienda.com/x' }),
      /deadline agotado/,
    );
  });
});
