import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const SHOP_HTML = `<!doctype html><html><head><title>Tienda Demo</title></head><body>
<button class="buy">Comprar ahora</button>
<div class="product-card"><span class="name">Samsung Galaxy A1</span><span class="price">$399.00</span></div>
<a href="/cat/electronica">Electrónica</a>
<a href="/ofertas">Ofertas</a>
</body></html>`;

const AFTER_CLICK_HTML = `<!doctype html><html><head><title>Checkout</title></head><body>
<div class="product-card"><span class="name">Checkout OK</span><span class="price">$399.00</span></div>
</body></html>`;

describe('Escalado browser ETAPA 3 (CLICK/SCROLL via delegado)', async () => {
  const { ExecutionEngine } = await import('../packages/execution-engine/dist/execution-engine.js');

  const fetcher = async () => SHOP_HTML;
  const calls = [];
  const browserInteract = async (url, action) => {
    calls.push({ url, action });
    if (action.kind === 'click') return { html: AFTER_CLICK_HTML, url: url + '#checkout', title: 'Checkout' };
    return { html: SHOP_HTML.replace('</body>', '<div class="product-card"><span class="name">Lazy Item</span></div></body>'), url, title: 'Tienda Demo' };
  };

  it('CLICK no-enlace con delegado resuelve en browser y carga el HTML', async () => {
    const engine = new ExecutionEngine({ fetcher, browserInteract });
    await engine.execute({ type: 'NAVIGATE', url: 'https://tienda.com/productos' });
    const r = await engine.execute({ type: 'CLICK', selector: '.buy' });
    assert.equal(r.ok, true);
    assert.equal(r.usedBrowser, true);
    assert.equal(r.needsBrowser, undefined);
    const ex = await engine.execute({ type: 'EXTRACT_LIST', selector: '.product-card', fields: { name: '.name' } });
    assert.equal(ex.ok, true);
    assert.equal(ex.items[0].name.value, 'Checkout OK');
  });

  it('CLICK no-enlace sin delegado mantiene needsBrowser (compat)', async () => {
    const engine = new ExecutionEngine({ fetcher });
    await engine.execute({ type: 'NAVIGATE', url: 'https://tienda.com/productos' });
    const r = await engine.execute({ type: 'CLICK', selector: '.buy' });
    assert.equal(r.ok, false);
    assert.equal(r.needsBrowser, true);
  });

  it('SCROLL con delegado hace scroll real y marca usedBrowser', async () => {
    const engine = new ExecutionEngine({ fetcher, browserInteract });
    await engine.execute({ type: 'NAVIGATE', url: 'https://tienda.com/productos' });
    const r = await engine.execute({ type: 'SCROLL' });
    assert.equal(r.ok, true);
    assert.equal(r.usedBrowser, true);
    const ex = await engine.execute({ type: 'EXTRACT_LIST', selector: '.product-card', fields: { name: '.name' } });
    assert.ok(ex.count >= 2);
  });

  it('FOLLOW_LINKS no refetchea URLs ya visitadas', async () => {
    let fetchCount = 0;
    const countingFetcher = async (url) => {
      fetchCount += 1;
      if (url.includes('/cat/')) return SHOP_HTML;
      return SHOP_HTML;
    };
    const engine = new ExecutionEngine({ fetcher: countingFetcher });
    await engine.execute({ type: 'NAVIGATE', url: 'https://tienda.com/productos' });
    const before = fetchCount;
    const r1 = await engine.execute({ type: 'FOLLOW_LINKS', selector: 'a', maxLinks: 2 });
    assert.equal(r1.ok, true);
    const afterFirst = fetchCount;
    assert.ok(afterFirst > before);
    // Segunda pasada sobre los mismos enlaces: 0 fetches nuevos
    const r2 = await engine.execute({ type: 'FOLLOW_LINKS', selector: 'a', maxLinks: 2 });
    assert.equal(r2.ok, true);
    assert.equal(fetchCount, afterFirst);
    assert.equal(r2.count, 0);
  });
});
