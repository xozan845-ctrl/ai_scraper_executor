import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

const {
  validateField,
  enrichItem,
  enrichItems,
} = await import('../libs/application/scraper/dist/index.js');

const traced = (value, source = { url: 'https://shop.com/', selector: '.card', kind: 'jsonld' }) => ({
  value,
  source,
});

describe('P3 — validadores semánticos y confianza real', () => {
  it('valida tipos: price, number, url, date, email y boolean', () => {
    const eur = validateField('1.250,50 €', { type: 'price' });
    assert.equal(eur.normalized, 1250.5);
    assert.equal(eur.currency, 'EUR');
    assert.equal(validateField('1,250.50', { type: 'number' }).normalized, 1250.5);
    assert.equal(validateField('https://shop.com/p/1', { type: 'url' }).valid, true);
    assert.equal(validateField('javascript:alert(1)', { type: 'url' }).valid, false);
    assert.equal(validateField('2026-01-15', { type: 'date' }).normalized, '2026-01-15T00:00:00.000Z');
    assert.equal(validateField('no-es-fecha', { type: 'date' }).valid, false);
    assert.equal(validateField('a@b.com', { type: 'email' }).valid, true);
    assert.equal(validateField('a@b', { type: 'email' }).valid, false);
    assert.equal(validateField('sí', { type: 'boolean' }).normalized, true);
    assert.equal(validateField('quizá', { type: 'boolean' }).valid, false);
  });

  it('aplica required, pattern, min/max y enum', () => {
    assert.equal(validateField(undefined, { required: true }).valid, false);
    assert.deepEqual(validateField(undefined, { required: true }).errors, ['required']);
    assert.equal(validateField('ABC-1', { pattern: '^[A-Z]+-\\d+$' }).valid, true);
    assert.equal(validateField('abc', { pattern: '^[A-Z]+$' }).valid, false);
    assert.equal(validateField('5', { type: 'number', min: 10 }).valid, false);
    assert.equal(validateField('15', { type: 'number', max: 10 }).valid, false);
    assert.equal(validateField('rojo', { enum: ['rojo', 'azul'] }).valid, true);
    assert.equal(validateField('verde', { enum: ['rojo', 'azul'] }).valid, false);
  });

  it('calcula confianza compuesta por validación y fiabilidad de la fuente', () => {
    const schema = {
      fields: {
        name: { type: 'string', required: true },
        price: { type: 'price', required: true, min: 1 },
      },
    };
    const ok = enrichItem({ name: traced('A'), price: traced('$10'), _source: { kind: 'jsonld' } }, schema);
    assert.equal(ok._source.confidence, 1);
    assert.equal(ok._source.validation.valid, true);
    assert.equal(ok.price.normalized, 10);
    assert.equal(ok.price.currency, 'USD');

    const bad = enrichItem({ name: traced('A'), price: traced('gratis'), _source: { kind: 'dom' } }, schema);
    assert.equal(bad._source.validation.valid, false);
    assert.ok(bad._source.validation.fields.price.includes('price inválido'));
    assert.equal(bad._source.confidence, 0.68); // (1 + 0.5) / 2 · 0.9

    const domOk = enrichItem({ name: traced('A'), price: traced('$10'), _source: { kind: 'dom' } }, schema);
    assert.equal(domOk._source.confidence, 0.9);
  });

  it('marca campos requeridos ausentes y permite filtrar strict', () => {
    const schema = { strict: true, fields: { name: { required: true }, price: { type: 'price' } } };
    const items = enrichItems([
      { name: traced('A'), price: traced('$10'), _source: { kind: 'network' } },
      { name: traced(''), _source: { kind: 'network' } },
    ], schema);
    assert.equal(items.length, 2);
    assert.equal(items[0]._source.validation.valid, true);
    assert.equal(items[1]._source.validation.valid, false);
    assert.ok(items[1]._source.validation.fields.name.includes('required'));
    const valid = items.filter((item) => item._source.validation.valid !== false);
    assert.equal(valid.length, 1);
  });

  it('sin esquema conserva la confianza por completitud', () => {
    const item = enrichItem({
      name: traced('A'),
      price: traced(null),
      _source: { url: 'https://x.com' },
    });
    assert.equal(item._source.confidence, 0.5);
    assert.equal(item._source.validation, undefined);
  });
});
