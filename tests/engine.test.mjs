import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const SHOP_HTML = `<!doctype html><html><head><title>Tienda Demo</title></head><body>
<a href="/cat/electronica">Electrónica</a>
<a href="/ofertas">Ofertas</a>
<div class="product-card"><span class="name">Samsung Galaxy A1</span><span class="price">$399.00</span><img src="/img/a1.jpg"/></div>
<div class="product-card"><span class="name">Samsung Galaxy B2</span><span class="price">$499.00</span><img src="/img/b2.jpg"/></div>
<a class="next" href="/productos?page=2">Siguiente</a>
</body></html>`;

describe('ExecutionEngine FASE 2 (HTTP/Cheerio con fetcher mock)', async () => {
  const { ExecutionEngine } = await import('../packages/execution-engine/dist/execution-engine.js');

  const fetcher = async (url) => {
    if (url.includes('page=2')) {
      return SHOP_HTML.replaceAll('A1', 'C3').replaceAll('B2', 'D4');
    }
    return SHOP_HTML;
  };

  it('NAVIGATE + INSPECT + EXTRACT_LIST con trazabilidad', async () => {
    const engine = new ExecutionEngine({ fetcher });
    let r = await engine.execute({ type: 'NAVIGATE', url: 'https://tienda.com/productos' });
    assert.equal(r.ok, true);

    r = await engine.execute({ type: 'INSPECT_LINKS' });
    assert.equal(r.ok, true);
    assert.ok(r.count >= 2);

    r = await engine.execute({
      type: 'EXTRACT_LIST',
      selector: '.product-card',
      fields: { name: '.name', price: '.price', image: { selector: 'img', attribute: 'src' } },
    });
    assert.equal(r.ok, true);
    assert.equal(r.count, 2);
    assert.equal(r.items[0].name.value, 'Samsung Galaxy A1');
    assert.equal(r.items[0]._source.url, 'https://tienda.com/productos');
  });

  it('EXTRACT_LIST con selector inexistente devuelve error recuperable', async () => {
    const engine = new ExecutionEngine({ fetcher });
    await engine.execute({ type: 'NAVIGATE', url: 'https://tienda.com/productos' });
    const r = await engine.execute({ type: 'EXTRACT_LIST', selector: '.no-existe', fields: { a: '.x' } });
    assert.equal(r.ok, false);
    assert.match(r.error, /Recovery/);
  });

  it('PAGINATE por pattern genera URLs y CLICK no-enlace pide browser', async () => {
    const engine = new ExecutionEngine({ fetcher });
    await engine.execute({ type: 'NAVIGATE', url: 'https://tienda.com/productos' });
    const p = await engine.execute({ type: 'PAGINATE', pattern: 'https://tienda.com/productos?page=N', maxPages: 3 });
    assert.equal(p.ok, true);
    assert.deepEqual(p.items, [
      'https://tienda.com/productos?page=1',
      'https://tienda.com/productos?page=2',
      'https://tienda.com/productos?page=3',
    ]);
    const c = await engine.execute({ type: 'CLICK', selector: '.product-card' });
    assert.equal(c.needsBrowser, true);
  });

  it('bloquea SSRF en NAVIGATE', async () => {
    const engine = new ExecutionEngine({ fetcher });
    const r = await engine.execute({ type: 'NAVIGATE', url: 'http://127.0.0.1/admin' });
    assert.equal(r.ok, false);
    assert.match(r.error, /SSRF/);
  });
});
