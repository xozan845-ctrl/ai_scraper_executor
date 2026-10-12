import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

const RICH_HTML = `<!doctype html><html><head><title>Rica</title></head><body>
<p>Contenido suficientemente largo para no requerir render dinámico en la heurística de detección aprobada por el equipo y validada con casos de prueba reales del repositorio, con bastante texto visible. Este párrafo se repite intencionadamente para superar con holgura el umbral de texto visible que decide que la página ya viene renderizada del servidor y por tanto no necesita Chromium.</p>
<div class="product-card"><span class="name">Producto A</span><span class="price">$10</span></div>
<div class="product-card"><span class="name">Producto B</span><span class="price">$20</span></div>
</body></html>`;

const THIN_SPA = `<!doctype html><html><head><title>App</title></head><body>
<div id="root"></div>
<script src="/app.js"></script><script src="/vendor.js"></script>
<script src="/runtime.js"></script><script src="/polyfills.js"></script><script src="/main.js"></script>
</body></html>`;

const CF_HTML = `<!doctype html><html><head><title>Just a moment...</title></head><body>Just a moment...</body></html>`;

describe('Bloque 1 — fetch robusto, render-on-demand y anti-bot', async () => {
  const { ExecutionEngine } = await import('../libs/infrastructure/execution/dist/execution-engine.js');
  const { fetchWithRetry, isRetryableError, needsBrowserRender, detectChallenge, visibleTextLength } =
    await import('../libs/infrastructure/execution/dist/index.js');
  const { HttpError } = await import('../libs/shared/security/dist/index.js');

  const noSleep = async () => undefined;

  describe('D — reintentos selectivos', () => {
    it('reintenta 5xx y acaba con éxito', async () => {
      let n = 0;
      const out = await fetchWithRetry(
        async () => {
          n += 1;
          if (n < 3) throw new HttpError('HTTP 503', 503);
          return 'ok';
        },
        { sleep: noSleep, random: () => 0 },
      );
      assert.equal(out, 'ok');
      assert.equal(n, 3);
    });

    it('no reintenta 4xx (404)', async () => {
      let n = 0;
      await assert.rejects(
        () => fetchWithRetry(async () => { n += 1; throw new HttpError('HTTP 404', 404); }, { sleep: noSleep }),
        /404/,
      );
      assert.equal(n, 1);
    });

    it('reintenta error de red transitorio', async () => {
      let n = 0;
      const out = await fetchWithRetry(
        async () => {
          n += 1;
          if (n === 1) {
            const e = new Error('socket hang up');
            e.code = 'ECONNRESET';
            throw e;
          }
          return 'ok';
        },
        { sleep: noSleep, random: () => 0 },
      );
      assert.equal(out, 'ok');
      assert.equal(n, 2);
    });

    it('respeta maxRetries y propaga el último error', async () => {
      let n = 0;
      await assert.rejects(
        () => fetchWithRetry(async () => { n += 1; throw new HttpError('HTTP 500', 500); }, { maxRetries: 1, sleep: noSleep, random: () => 0 }),
        /500/,
      );
      assert.equal(n, 2);
    });

    it('429 respeta Retry-After', async () => {
      const delays = [];
      let n = 0;
      const out = await fetchWithRetry(
        async () => {
          n += 1;
          if (n === 1) throw new HttpError('HTTP 429', 429, 1500);
          return 'ok';
        },
        { sleep: async (ms) => { delays.push(ms); }, random: () => 0 },
      );
      assert.equal(out, 'ok');
      assert.deepEqual(delays, [1500]);
    });

    it('isRetryableError clasifica por status', () => {
      assert.equal(isRetryableError(new HttpError('x', 500)), true);
      assert.equal(isRetryableError(new HttpError('x', 429)), true);
      assert.equal(isRetryableError(new HttpError('x', 404)), false);
      assert.equal(isRetryableError(new HttpError('x', 400)), false);
    });
  });

  describe('A — heurística de render', () => {
    it('needsBrowserRender: HTML rico → false; SPA fina → true; vacío → false', () => {
      assert.equal(needsBrowserRender(RICH_HTML), false);
      assert.equal(needsBrowserRender(THIN_SPA), true);
      assert.equal(needsBrowserRender(''), false);
      assert.ok(visibleTextLength(RICH_HTML) >= 200);
    });

    it('NAVIGATE renderiza una SPA fina y deja el DOM listo para extraer', async () => {
      const actions = [];
      const browserInteract = async (url, action) => {
        actions.push(action.kind);
        return { html: RICH_HTML, url, title: 'Rica' };
      };
      const engine = new ExecutionEngine({ fetcher: async () => THIN_SPA, browserInteract });
      const nav = await engine.execute({ type: 'NAVIGATE', url: 'https://tienda.com/productos' });
      assert.equal(nav.ok, true);
      assert.equal(nav.usedBrowser, true);
      assert.deepEqual(actions, ['render']);
      const ex = await engine.execute({ type: 'EXTRACT_LIST', selector: '.product-card', fields: { name: '.name' } });
      assert.equal(ex.ok, true);
      assert.equal(ex.count, 2);
    });

    it('EXTRACT_LIST reintenta con render si el render en NAVIGATE falló', async () => {
      let calls = 0;
      const browserInteract = async (url, action) => {
        calls += 1;
        if (calls === 1) throw new Error('browser no disponible');
        return { html: RICH_HTML, url, title: 'Rica' };
      };
      const engine = new ExecutionEngine({ fetcher: async () => THIN_SPA, browserInteract });
      await engine.execute({ type: 'NAVIGATE', url: 'https://tienda.com/productos' });
      const ex = await engine.execute({ type: 'EXTRACT_LIST', selector: '.product-card', fields: { name: '.name' } });
      assert.equal(ex.ok, true);
      assert.equal(ex.usedBrowser, true);
      assert.equal(ex.count, 2);
    });
  });

  describe('E — anti-bot', () => {
    it('detectChallenge reconoce cloudflare/recaptcha/hcaptcha', () => {
      assert.equal(detectChallenge(CF_HTML), 'cloudflare');
      assert.equal(detectChallenge('<div class="g-recaptcha"></div>'), 'recaptcha');
      assert.equal(detectChallenge('<script src="https://hcaptcha.com/1/api.js"></script>'), 'hcaptcha');
      assert.equal(detectChallenge(THIN_SPA), null);
    });

    it('NAVIGATE falla con error accionable ante challenge Cloudflare sin delegado browser', async () => {
      const engine = new ExecutionEngine({ fetcher: async () => CF_HTML });
      const r = await engine.execute({ type: 'NAVIGATE', url: 'https://tienda.com/' });
      assert.equal(r.ok, false);
      assert.match(r.error, /anti-bot/);
    });

    it('NAVIGATE escapa del challenge renderizando con browser', async () => {
      const browserInteract = async (url) => ({ html: RICH_HTML, url, title: 'Rica' });
      const engine = new ExecutionEngine({ fetcher: async () => CF_HTML, browserInteract });
      const r = await engine.execute({ type: 'NAVIGATE', url: 'https://tienda.com/' });
      assert.equal(r.ok, true);
      assert.equal(r.usedBrowser, true);
    });
  });
});
