import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

/**
 * Aislamiento de la caché de páginas por credenciales (seguridad cross-session).
 * La caché es compartida entre engines (misma réplica/Redis), pero el HTML
 * autenticado de un contexto NUNCA debe servirse a otro con credenciales distintas.
 */
describe('Caché de páginas aislada por credenciales', async () => {
  const { ExecutionEngine, PageCache } = await import('../libs/infrastructure/execution/dist/index.js');

  const URL_P = 'https://tienda.com/cuenta';
  const html = (marker) => `<!doctype html><html><head><title>${marker}</title></head><body><span id="v">${marker}</span></body></html>`;

  function makeEngine(shared, options) {
    const engine = new ExecutionEngine({
      pageCache: shared,
      fetcher: async () => html(options.marker),
      ...(options.headers ? { headers: options.headers } : {}),
    });
    return { engine };
  }

  async function markerOf(engine) {
    const r = await engine.execute({ type: 'EXTRACT', fields: { v: '#v' } });
    return r.items[0].v.value;
  }

  it('no filtra HTML autenticado a un contexto anónimo', async () => {
    const shared = new PageCache({ ttlMs: 60_000, maxEntries: 10 });
    const auth = makeEngine(shared, { marker: 'secreto', headers: { Authorization: 'Bearer A' } });
    const anon = makeEngine(shared, { marker: 'publico' });

    await auth.engine.execute({ type: 'NAVIGATE', url: URL_P });
    await anon.engine.execute({ type: 'NAVIGATE', url: URL_P });

    assert.equal(await markerOf(anon.engine), 'publico', 'el anónimo no debe recibir el HTML autenticado');
    assert.equal(await markerOf(auth.engine), 'secreto');
  });

  it('no filtra entre credenciales distintas', async () => {
    const shared = new PageCache({ ttlMs: 60_000, maxEntries: 10 });
    const a = makeEngine(shared, { marker: 'userA', headers: { Authorization: 'Bearer A' } });
    const b = makeEngine(shared, { marker: 'userB', headers: { Authorization: 'Bearer B' } });

    await a.engine.execute({ type: 'NAVIGATE', url: URL_P });
    await b.engine.execute({ type: 'NAVIGATE', url: URL_P });

    assert.equal(await markerOf(a.engine), 'userA');
    assert.equal(await markerOf(b.engine), 'userB');
  });

  it('mismo contexto de credenciales SÍ comparte caché (sin coste extra)', async () => {
    const shared = new PageCache({ ttlMs: 60_000, maxEntries: 10 });
    let fetches = 0;
    const fetcher = async () => { fetches += 1; return html('mismo'); };
    const e1 = new ExecutionEngine({ pageCache: shared, fetcher, headers: { Authorization: 'Bearer A' } });
    const e2 = new ExecutionEngine({ pageCache: shared, fetcher, headers: { Authorization: 'Bearer A' } });

    await e1.execute({ type: 'NAVIGATE', url: URL_P });
    await e2.execute({ type: 'NAVIGATE', url: URL_P });
    assert.equal(fetches, 1, 'el mismo contexto reutiliza la entrada de caché');
  });

  it('el scope ignora el orden y las mayúsculas de los headers', async () => {
    const shared = new PageCache({ ttlMs: 60_000, maxEntries: 10 });
    let fetches = 0;
    const fetcher = async () => { fetches += 1; return html('x'); };
    const e1 = new ExecutionEngine({ pageCache: shared, fetcher, headers: { Authorization: 'Bearer A', 'X-Tenant': 't1' } });
    const e2 = new ExecutionEngine({ pageCache: shared, fetcher, headers: { 'x-tenant': 't1', authorization: 'Bearer A' } });

    await e1.execute({ type: 'NAVIGATE', url: URL_P });
    await e2.execute({ type: 'NAVIGATE', url: URL_P });
    assert.equal(fetches, 1, 'Authorization/autorization y orden no deben cambiar el scope');
  });

  it('anónimos siguen compartiendo caché (comportamiento previo intacto)', async () => {
    const shared = new PageCache({ ttlMs: 60_000, maxEntries: 10 });
    let fetches = 0;
    const fetcher = async () => { fetches += 1; return html('anon'); };
    const e1 = new ExecutionEngine({ pageCache: shared, fetcher });
    const e2 = new ExecutionEngine({ pageCache: shared, fetcher });

    await e1.execute({ type: 'NAVIGATE', url: URL_P });
    await e2.execute({ type: 'NAVIGATE', url: URL_P });
    assert.equal(fetches, 1);
  });
});
