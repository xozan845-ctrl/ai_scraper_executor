import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Guard de navegación SSRF en el navegador: aborta redirects/subrecursos a hosts
 * privados/metadata. Se prueba el handler con rutas simuladas (sin lanzar Chromium).
 */
describe('Guard de navegación SSRF (browser)', async () => {
  const { installNavigationGuard } = await import('../libs/infrastructure/crawler/dist/crawler.service.js');

  function fakePage() {
    let handler;
    return {
      page: { route: async (_pattern, h) => { handler = h; } },
      getHandler: () => handler,
    };
  }

  function fakeRoute(url, actions, opts = {}) {
    return {
      request: () => ({
        url: () => url,
        headers: () => ({ Accept: 'text/html' }),
        isNavigationRequest: () => opts.navigation ?? true,
      }),
      abort: (reason) => void actions.push(['abort', reason]),
      continue: (value) => void actions.push(['continue', value]),
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

    assert.deepEqual(actions.map(([action, reason]) => reason === undefined ? [action] : [action, reason]), [
      ['abort', 'blockedbyclient'], ['abort', 'blockedbyclient'], ['abort', 'blockedbyclient'], ['continue'], ['continue'],
    ]);
  });

  it('ALLOW_PRIVATE_HOSTS permite localhost (dev/test)', async () => {
    process.env.ALLOW_PRIVATE_HOSTS = '1';
    try {
      const { page, getHandler } = fakePage();
      await installNavigationGuard(page);
      const actions = [];
      await getHandler()(fakeRoute('http://127.0.0.1:8080/', actions));
      assert.deepEqual(actions, [['continue', undefined]]);
    } finally {
      delete process.env.ALLOW_PRIVATE_HOSTS;
    }
  });

  it('bloquea navegación fuera del dominio y aplica credenciales solo al origin autorizado', async () => {
    process.env.ALLOW_PRIVATE_HOSTS = '1';
    try {
      const { page, getHandler } = fakePage();
      await installNavigationGuard(page, {
        allowedDomain: 'example.com',
        credentialOrigin: 'https://example.com',
        headers: { Authorization: 'Bearer secret' },
      });
      const actions = [];
      await getHandler()(fakeRoute('https://example.com/account', actions));
      await getHandler()(fakeRoute('https://cdn.example.net/app.js', actions, { navigation: false }));
      await getHandler()(fakeRoute('https://evil.test/', actions));
      assert.deepEqual(actions, [
        ['continue', { headers: { Accept: 'text/html', Authorization: 'Bearer secret' } }],
        ['continue', undefined],
        ['abort', 'blockedbyclient'],
      ]);
    } finally {
      delete process.env.ALLOW_PRIVATE_HOSTS;
    }
  });
});
