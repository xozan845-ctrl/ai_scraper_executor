import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

describe('Interpretación de resultados (Etapa 2)', async () => {
  const { enrichItem, enrichItems } = await import('../apps/worker/dist/interpret.js');

  const item = (name, price, url = 'https://x.com/p') => ({
    name: { value: name, source: { url, selector: '.name' } },
    price: { value: price, source: { url, selector: '.price' } },
    _source: { url, selector: '.card', scrapedAt: '2026-01-01' },
  });

  it('normaliza precios a número + moneda', () => {
    const out = enrichItem(item('A', '$1,250.00'));
    assert.equal(out.price.normalized, 1250);
    assert.equal(out.price.currency, 'USD');
    assert.equal(out.price.value, '$1,250.00', 'conserva el valor original');
    const eur = enrichItem(item('B', '€ 9,99'));
    assert.equal(eur.price.normalized, 9.99);
    assert.equal(eur.price.currency, 'EUR');
  });

  it('calcula confidence por completitud de campos', () => {
    const full = enrichItem(item('A', '$10'));
    assert.equal(full._source.confidence, 1);
    const partial = enrichItem({
      name: { value: 'A', source: {} },
      price: { value: null, source: {} },
      _source: { url: 'https://x.com' },
    });
    assert.equal(partial._source.confidence, 0.5);
  });

  it('deduplica items idénticos (por link o por valores)', () => {
    const withLink = (href) => ({
      name: { value: 'A', source: {} },
      link: { value: href, source: {} },
      _source: { url: 'https://x.com' },
    });
    const out = enrichItems([withLink('/p/1'), withLink('/p/1'), withLink('/p/2')]);
    assert.equal(out.length, 2);
    // Sin link: dedup por valores
    const out2 = enrichItems([item('A', '$10'), item('A', '$10'), item('B', '$20')]);
    assert.equal(out2.length, 2);
  });

  it('no rompe con valores no string', () => {
    const out = enrichItem({ qty: { value: 5, source: {} }, _source: { url: 'u' } });
    assert.equal(out._source.confidence, 1);
    assert.equal(out.qty.normalized, undefined);
  });
});
