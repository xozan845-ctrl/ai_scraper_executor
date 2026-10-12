import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

const SHOP_HTML = `<!doctype html><html><head><title>Tienda</title></head><body>
<div class="product-card"><span class="name">A</span><span class="price">$1</span></div>
<div class="product-card"><span class="name">B</span><span class="price">$2</span></div>
</body></html>`;

describe('C — fallback a selectores aprendidos (bloque 3)', async () => {
  const { ExecutionEngine } = await import('../libs/infrastructure/execution/dist/execution-engine.js');

  it('usa el selector aprendido cuando el de la IA encuentra 0 elementos', async () => {
    let calls = 0;
    const engine = new ExecutionEngine({
      fetcher: async () => SHOP_HTML,
      fallbackSelectors: async () => {
        calls += 1;
        return ['.wrong', '.product-card'];
      },
    });
    await engine.execute({ type: 'NAVIGATE', url: 'https://tienda.com/productos' });
    const r = await engine.execute({
      type: 'EXTRACT_LIST',
      selector: '.no-existe',
      fields: { name: '.name', price: '.price' },
    });
    assert.equal(r.ok, true);
    assert.equal(r.count, 2);
    assert.match(r.nextHint, /selector aprendido: \.product-card/);
    assert.equal(r.items[0]._source.selector, '.product-card');
    assert.equal(r.items[0]._source.url, 'https://tienda.com/productos');
    assert.equal(calls, 1);
  });

  it('no consulta la memoria si el selector primario funciona', async () => {
    let calls = 0;
    const engine = new ExecutionEngine({
      fetcher: async () => SHOP_HTML,
      fallbackSelectors: async () => {
        calls += 1;
        return ['.product-card'];
      },
    });
    await engine.execute({ type: 'NAVIGATE', url: 'https://tienda.com/productos' });
    const r = await engine.execute({ type: 'EXTRACT_LIST', selector: '.product-card', fields: { name: '.name' } });
    assert.equal(r.ok, true);
    assert.equal(calls, 0);
  });

  it('sin fallback disponible mantiene el error recuperable', async () => {
    const engine = new ExecutionEngine({ fetcher: async () => SHOP_HTML, fallbackSelectors: async () => [] });
    await engine.execute({ type: 'NAVIGATE', url: 'https://tienda.com/productos' });
    const r = await engine.execute({ type: 'EXTRACT_LIST', selector: '.no-existe', fields: { name: '.name' } });
    assert.equal(r.ok, false);
    assert.match(r.error, /Recovery/);
  });

  it('un fallo del proveedor de memoria no rompe el scraping', async () => {
    const engine = new ExecutionEngine({
      fetcher: async () => SHOP_HTML,
      fallbackSelectors: async () => {
        throw new Error('mongo caído');
      },
    });
    await engine.execute({ type: 'NAVIGATE', url: 'https://tienda.com/productos' });
    const r = await engine.execute({ type: 'EXTRACT_LIST', selector: '.no-existe', fields: { name: '.name' } });
    assert.equal(r.ok, false);
    assert.match(r.error, /Recovery/);
  });

  it('no reintenta el mismo selector que falló', async () => {
    const engine = new ExecutionEngine({
      fetcher: async () => SHOP_HTML,
      fallbackSelectors: async () => ['.no-existe', '.product-card'],
    });
    await engine.execute({ type: 'NAVIGATE', url: 'https://tienda.com/productos' });
    const r = await engine.execute({ type: 'EXTRACT_LIST', selector: '.no-existe', fields: { name: '.name' } });
    assert.equal(r.ok, true);
    assert.equal(r.items[0]._source.selector, '.product-card');
  });
});
