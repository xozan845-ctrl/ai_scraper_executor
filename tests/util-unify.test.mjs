import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Fuentes únicas: `hashHtml` (core) y `normalizeDomain` (security) no deben
 * divergir entre los paquetes que las reexportan.
 */
describe('Utilidades unificadas (hashHtml / normalizeDomain)', async () => {
  const { hashHtml: coreHash } = await import('../libs/shared/core/dist/index.js');
  const { hashHtml: crawlerHash } = await import('../packages/crawler/dist/crawler.service.js');
  const { hashHtml: mongoHash, normalizeDomain: mongoNorm } = await import('../packages/mongodb/dist/repository.js');
  const { normalizeDomain: secNorm } = await import('../packages/security/dist/allowlist.js');

  it('hashHtml es idéntico en core, crawler y mongodb', () => {
    for (const s of ['', 'abc', '<html>hola</html>', 'x'.repeat(1000), 'áéíóú €']) {
      const expected = coreHash(s);
      assert.equal(crawlerHash(s), expected, `crawler difiere para ${JSON.stringify(s)}`);
      assert.equal(mongoHash(s), expected, `mongodb difiere para ${JSON.stringify(s)}`);
    }
  });

  it('normalizeDomain: canónico en security, con stripWww explícito para perfiles', () => {
    assert.equal(secNorm('https://www.Tienda.com/x'), 'www.tienda.com', 'allowlist no elimina www por defecto');
    assert.equal(secNorm('https://www.Tienda.com/x', { stripWww: true }), 'tienda.com');
    assert.equal(secNorm('tienda.com:8080'), 'tienda.com');
    assert.equal(mongoNorm('https://www.Tienda.com/path?q=1'), 'tienda.com', 'perfiles eliminan www');
    assert.equal(mongoNorm('tienda.com'), 'tienda.com');
  });
});
