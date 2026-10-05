import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Guard de navegación SSRF en el navegador: aborta redirects/subrecursos a hosts
 * privados/metadata. Se prueba el handler con rutas simuladas (sin lanzar Chromium).
 */
describe('Guard de navegación SSRF (browser)', async () => {
  const { installNavigationGuard } = await import('../packages/crawler/dist/crawler.service.js');

  function fakePage() {
    let handler;
    return {
      page: { route: async (_pattern, h) => { handler = h; } },
      getHandler: () => handler,
    };
  }

  function fakeRoute(url, actions) {
    return {
      request: () => ({ url: () => url }),
      abort: (reason) => void actions.push(['abort', reason]),
      continue: () => void actions.push(['continue']),
    };
  }

  it('aborta hosts privados/metadata y permite literales públicos', async () => {
    delete process.env.ALLOW_PRIVATE_HOSTS;
    const { page, getHandler } = fakePage();
    await installNavigationGuard(page);
    const handler = getHandler();
    const actions = [];
    await handler(fakeRoute('http://169.254.169.254/latest/meta-data', actions));
    await handler(fakeRoute('http://127.0.0.1:8080/admin', actions));
    await handler(fakeRoute('http://10.0.0.5/', actions));
    await handler(fakeRoute('http://93.184.216.34/', actions)); // IP pública literal (sin DNS)
    await handler(fakeRoute('data:text/html,hola', actions));

    assert.deepEqual(actions, [
      ['abort', 'blockedbyclient'],
      ['abort', 'blockedbyclient'],
      ['abort', 'blockedbyclient'],
      ['continue'],
      ['continue'],
    ]);
  });

  it('ALLOW_PRIVATE_HOSTS permite localhost (dev/test)', async () => {
    process.env.ALLOW_PRIVATE_HOSTS = '1';
    try {
      const { page, getHandler } = fakePage();
      await installNavigationGuard(page);
      const actions = [];
      await getHandler()(fakeRoute('http://127.0.0.1:8080/', actions));
      assert.deepEqual(actions, [['continue']]);
    } finally {
      delete process.env.ALLOW_PRIVATE_HOSTS;
    }
  });
});
