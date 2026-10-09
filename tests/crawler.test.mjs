import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const HOME = `<!doctype html><html><head><title>Home Shop</title></head><body>
<h1>Home</h1>
<a href="/cat">Categoría</a>
<div class="product-card"><span class="name">Prod Home</span><span class="price">$10</span></div>
</body></html>`;
const CAT = `<!doctype html><html><head><title>Cat</title></head><body>
<h1>Cat</h1><a href="/">Home</a>
<div class="product-card"><span class="name">Prod Cat</span><span class="price">$20</span></div>
</body></html>`;
const depthPage = (n) => `<!doctype html><html><head><title>D${n}</title></head><body>${n < 3 ? `<a href="/d${n + 1}">next</a>` : ''}</body></html>`;

describe('CrawlerService FASE 1 (HTTP contra servidor local)', async () => {
  const { CrawlerService } = await import('../packages/crawler/dist/crawler.service.js');
  let server;
  let base;

  before(async () => {
    process.env.ALLOW_PRIVATE_HOSTS = '1';
    await new Promise((resolve) => {
      server = http
        .createServer((req, res) => {
          res.setHeader('content-type', 'text/html');
          const depth = req.url?.match(/^\/d(\d+)/)?.[1];
          res.end(depth !== undefined ? depthPage(Number(depth)) : req.url?.startsWith('/cat') ? CAT : HOME);
        })
        .listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => new Promise((r) => server.close(r)));

  it('crawl http descubre páginas, links y elementos', async () => {
    const svc = new CrawlerService();
    const { pages, stats } = await svc.crawlDetailed({ url: base + '/', mode: 'http', maxRequests: 5, maxDepth: 1 });
    assert.ok(pages.length >= 1);
    assert.equal(stats.usedBrowser, false);
    const home = pages.find((p) => p.url === base + '/');
    assert.ok(home);
    assert.equal(home.title, 'Home Shop');
    assert.ok(home.links.some((l) => l.href.includes('/cat')));
    assert.ok(home.elements.length >= 1);
    // Radiografía real: hash del HTML + conteo por selector
    assert.equal(typeof home.htmlHash, 'string');
    assert.ok(home.htmlHash.length > 0);
    assert.ok(Array.isArray(home.elementCounts));
    assert.ok(home.elementCounts.some((e) => e.selector === '.product-card' && e.count >= 1));
  });

  it('inspectSinglePage no encola y devuelve contexto reducido', async () => {
    const svc = new CrawlerService();
    const page = await svc.inspectSinglePage(base + '/', 'http');
    assert.equal(page.title, 'Home Shop');
    assert.ok(page.textSnippet.length > 0);
  });

  it('maxDepth limita la profundidad real del grafo', async () => {
    const svc = new CrawlerService();
    const { pages } = await svc.crawlDetailed({ url: base + '/d0', mode: 'http', maxRequests: 10, maxDepth: 1 });
    assert.deepEqual(pages.map((page) => new URL(page.url).pathname).sort(), ['/d0', '/d1']);
  });

  it('bloquea metadata endpoint aunque ALLOW_PRIVATE esté activo en otro test', async () => {
    delete process.env.ALLOW_PRIVATE_HOSTS;
    const svc = new CrawlerService();
    await assert.rejects(() => svc.inspectSinglePage('http://169.254.169.254/latest', 'http'), /SSRF/);
    process.env.ALLOW_PRIVATE_HOSTS = '1';
  });
});
