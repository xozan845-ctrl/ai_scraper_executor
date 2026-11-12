import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

const SHOP_HTML = `<!doctype html><html><head><title>Tienda Demo</title></head><body>
<a href="/cat/electronica">Electrónica</a>
<a href="/ofertas">Ofertas</a>
<div class="product-card"><span class="name">Samsung Galaxy A1</span><span class="price">$399.00</span><img src="/img/a1.jpg"/></div>
<div class="product-card"><span class="name">Samsung Galaxy B2</span><span class="price">$499.00</span><img src="/img/b2.jpg"/></div>
<a class="next" href="/productos?page=2">Siguiente</a>
</body></html>`;

describe('ExecutionEngine FASE 2 (HTTP/Cheerio con fetcher mock)', async () => {
  const { ExecutionEngine } = await import('../libs/infrastructure/execution/dist/execution-engine.js');

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

  it('EXTRACT_TABLE extrae filas con cabeceras y EXTRACT_TEXT texto limpio', async () => {
    const HTML = `<!doctype html><html><body>
      <table id="precios"><thead><tr><th>Nombre</th><th>Precio</th></tr></thead>
      <tbody><tr><td>Portátil</td><td>999</td></tr><tr><td>Ratón</td><td>20</td></tr></tbody></table>
      <div id="desc">Hola   <b>mundo</b>   scraping</div>
    </body></html>`;
    const engine = new ExecutionEngine({ fetcher: async () => HTML });
    await engine.execute({ type: 'NAVIGATE', url: 'https://tienda.com/tabla' });

    const table = await engine.execute({ type: 'EXTRACT_TABLE', selector: '#precios' });
    assert.equal(table.ok, true);
    assert.equal(table.count, 2);
    assert.equal(table.items[0].Nombre, 'Portátil');
    assert.equal(table.items[1].Precio, '20');
    assert.equal(table.items[0]._source.selector, '#precios tr:nth-child(1)');
    assert.equal(table.items[0]._source.url, 'https://tienda.com/tabla');

    const text = await engine.execute({ type: 'EXTRACT_TEXT', selector: '#desc', maxLength: 20 });
    assert.equal(text.ok, true);
    assert.equal(text.items[0].text, 'Hola mundo scraping');
    assert.equal(text.items[0]._source.selector, '#desc');

    const missing = await engine.execute({ type: 'EXTRACT_TEXT', selector: '#no-existe' });
    assert.equal(missing.ok, false);
  });

  it('render configurable para SPAs: mode always y opciones llegan al browser', async () => {
    const calls = [];
    const engine = new ExecutionEngine({
      fetcher: async () => '<html><body><div id="app"></div></body></html>',
      browserInteract: async (url, action) => {
        calls.push(action);
        return {
          url,
          title: 'SPA',
          html: `<html><body><app-root>${'contenido '.repeat(200)}</app-root></body></html>`,
        };
      },
      render: { mode: 'always', waitUntil: 'networkidle', waitForSelector: 'app-root', waitMs: 10, timeoutMs: 5000 },
    });
    const result = await engine.execute({ type: 'NAVIGATE', url: 'https://spa.example/' });
    assert.equal(result.ok, true);
    assert.equal(result.usedBrowser, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].kind, 'render');
    assert.deepEqual(calls[0].render, {
      mode: 'always', waitUntil: 'networkidle', waitForSelector: 'app-root', waitMs: 10, timeoutMs: 5000,
    });

    const never = new ExecutionEngine({
      fetcher: async () => '<html><body><div id="app"></div></body></html>',
      browserInteract: async () => { throw new Error('no debería renderizar'); },
      render: { mode: 'never' },
    });
    const noRender = await never.execute({ type: 'NAVIGATE', url: 'https://spa.example/' });
    assert.equal(noRender.ok, true);
    assert.equal(noRender.usedBrowser, false);
  });

  it('EXTRACT_STRUCTURED lee JSON-LD/OpenGraph/microdata y los selectores candidatos consensúan', async () => {
    const HTML = `<!doctype html><html><head>
      <meta property="og:title" content="Producto OG"/>
      <meta property="og:url" content="https://shop.com/p/1"/>
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Portátil","offers":{"price":"999","priceCurrency":"EUR"}}</script>
    </head><body>
      <div itemscope itemtype="https://schema.org/Product"><span itemprop="name">Ratón</span><meta itemprop="sku" content="S1"/></div>
      <div class="product-card"><span class="name">Portátil</span><span class="price">999</span></div>
    </body></html>`;
    const engine = new ExecutionEngine({ fetcher: async () => HTML });
    await engine.execute({ type: 'NAVIGATE', url: 'https://shop.com/p/1' });

    const jsonld = await engine.execute({ type: 'EXTRACT_STRUCTURED', source: 'jsonld' });
    assert.equal(jsonld.ok, true);
    assert.equal(jsonld.items[0].type, 'Product');
    assert.equal(jsonld.items[0].name, 'Portátil');
    assert.equal(jsonld.items[0]['offers.price'], '999');
    assert.equal(jsonld.items[0]._source.kind, 'jsonld');

    const og = await engine.execute({ type: 'EXTRACT_STRUCTURED', source: 'opengraph' });
    assert.equal(og.items[0].title, 'Producto OG');
    const micro = await engine.execute({ type: 'EXTRACT_STRUCTURED', source: 'microdata' });
    assert.equal(micro.items[0].name, 'Ratón');
    assert.equal(micro.items[0].sku, 'S1');

    const list = await engine.execute({
      type: 'EXTRACT_LIST',
      selector: '.product-card',
      fields: { name: ['.no-existe', '.name'], price: ['.price'] },
    });
    assert.equal(list.ok, true);
    assert.equal(list.items[0].name.value, 'Portátil');
    assert.equal(list.items[0].name.source.selector, '.product-card .name');
  });

  it('EXTRACT_NETWORK lee JSON de XHR/fetch capturado en el render', async () => {
    const engine = new ExecutionEngine({
      fetcher: async () => '<html><body><div id="app"></div></body></html>',
      browserInteract: async (url) => ({
        url,
        title: 'SPA',
        html: '<html><body><div id="app">ok</div></body></html>',
        network: [{
          url: 'https://api.shop.com/v1/products?page=1',
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { items: [{ name: 'A', price: 10 }, { name: 'B', price: 20 }] } }),
        }],
      }),
      render: { mode: 'always' },
    });
    await engine.execute({ type: 'NAVIGATE', url: 'https://shop.com/' });
    const page = await engine.execute({ type: 'INSPECT_PAGE' });
    assert.equal(page.data.network.count, 1);
    assert.equal(page.data.network.responses[0].status, 200);

    const extracted = await engine.execute({
      type: 'EXTRACT_NETWORK',
      urlContains: '/v1/products',
      path: 'data.items',
    });
    assert.equal(extracted.ok, true);
    assert.equal(extracted.count, 2);
    assert.equal(extracted.items[0].name, 'A');
    assert.equal(extracted.items[1].price, 20);
    assert.equal(extracted.items[0]._source.kind, 'network');

    const missing = await engine.execute({ type: 'EXTRACT_NETWORK', urlContains: '/no-existe' });
    assert.equal(missing.ok, false);
  });

  it('EXTRACT_LIST con selector inexistente devuelve error recuperable', async () => {
    const engine = new ExecutionEngine({ fetcher });
    await engine.execute({ type: 'NAVIGATE', url: 'https://tienda.com/productos' });
    const r = await engine.execute({ type: 'EXTRACT_LIST', selector: '.no-existe', fields: { a: '.x' } });
    assert.equal(r.ok, false);
    assert.match(r.error, /Recovery/);
  });

  it('todos los comandos que producen datos incluyen _source completo', async () => {
    const engine = new ExecutionEngine({ fetcher });
    await engine.execute({ type: 'NAVIGATE', url: 'https://tienda.com/productos' });
    const single = await engine.execute({ type: 'EXTRACT', fields: { title: '.name' } });
    const attrs = await engine.execute({ type: 'GET_ATTRIBUTE', selector: 'img', attribute: 'src' });
    const followed = await engine.execute({ type: 'FOLLOW_LINKS', selector: 'a.next', maxLinks: 1 });
    for (const result of [single, attrs, followed]) {
      assert.equal(result.ok, true);
      for (const item of result.items) {
        assert.equal(typeof item._source.url, 'string');
        assert.equal(typeof item._source.selector, 'string');
        assert.match(item._source.scrapedAt, /^\d{4}-\d{2}-\d{2}T/);
      }
    }
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

  it('mantiene la allowlist al navegar mediante un CLICK derivado del DOM', async () => {
    const fetched = [];
    const engine = new ExecutionEngine({
      fetcher: async (url) => {
        fetched.push(url);
        return '<a id="escape" href="https://evil.example/secret">salir</a>';
      },
    });
    await engine.execute({ type: 'NAVIGATE', url: 'https://shop.example/' });
    const result = await engine.execute({ type: 'CLICK', selector: '#escape' });
    assert.equal(result.ok, false);
    assert.match(result.error, /dominio permitido/);
    assert.deepEqual(fetched, ['https://shop.example/']);
  });

  it('FOLLOW_LINKS paraleliza con concurrencia acotada preservando el orden', async () => {
    const LINKS_HTML = `<!doctype html><html><body>${Array.from(
      { length: 6 },
      (_, i) => `<a class="next" href="/p/${i + 1}">L${i + 1}</a>`,
    ).join('')}</body></html>`;
    let inFlight = 0;
    let maxInFlight = 0;
    const fetcher = async (url) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      if (url === 'https://tienda.com/') return LINKS_HTML;
      return `<html><head><title>${url}</title></head><body>x</body></html>`;
    };
    const engine = new ExecutionEngine({ fetcher });
    await engine.execute({ type: 'NAVIGATE', url: 'https://tienda.com/' });
    const r = await engine.execute({ type: 'FOLLOW_LINKS', selector: 'a.next', maxLinks: 6 });
    assert.equal(r.ok, true);
    assert.equal(r.count, 6);
    assert.equal(maxInFlight, 3, 'la concurrencia debe ser 3');
    assert.deepEqual(
      r.items.map((i) => i.url),
      Array.from({ length: 6 }, (_, i) => `https://tienda.com/p/${i + 1}`),
    );
    assert.ok(r.items.every((i) => i._source.selector === 'a.next'));
  });

  it('acota la memoria de URLs visitadas a maxVisited (FIFO)', async () => {
    const engine = new ExecutionEngine({ fetcher, maxVisited: 2 });
    await engine.execute({ type: 'NAVIGATE', url: 'https://tienda.com/a' });
    await engine.execute({ type: 'NAVIGATE', url: 'https://tienda.com/b' });
    await engine.execute({ type: 'NAVIGATE', url: 'https://tienda.com/c' });
    assert.deepEqual(engine.getMemory().visited, ['https://tienda.com/b', 'https://tienda.com/c']);
  });
});
