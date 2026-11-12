import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

describe('J — dedupe de items (bloque 2)', async () => {
  const { dedupeItems, itemKey } = await import('../libs/domain/scraper/dist/index.js');

  const mk = (name, price, scrapedAt = '2026-01-01T00:00:00.000Z') => ({
    name: { value: name, source: { url: 'https://t.com', selector: '.name', scrapedAt } },
    price: { value: price, source: { url: 'https://t.com', selector: '.price', scrapedAt } },
    _source: { url: 'https://t.com', selector: '.product-card', scrapedAt },
  });

  it('quita duplicados conservando la primera aparición y el orden', () => {
    const a = mk('A', '$1');
    const b = mk('B', '$2');
    const aAgain = mk('A', '$1', '2026-02-02T00:00:00.000Z');
    const out = dedupeItems([a, b, aAgain]);
    assert.equal(out.length, 2);
    assert.equal(out[0], a);
    assert.equal(out[1], b);
  });

  it('itemKey ignora el sello scrapedAt y el orden de los campos', () => {
    assert.equal(itemKey(mk('A', '$1', 't1')), itemKey(mk('A', '$1', 't2')));
    const base = mk('A', '$1');
    const reversed = { _source: base._source, price: base.price, name: base.name };
    assert.equal(itemKey(reversed), itemKey(base));
  });

  it('items con distinto contenido no colisionan', () => {
    assert.notEqual(itemKey(mk('A', '$1')), itemKey(mk('A', '$2')));
  });
});
