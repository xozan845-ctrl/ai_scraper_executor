import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

const { evaluatePrecision } = await import('../libs/application/scraper/dist/index.js');

const item = (fields) => ({
  ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, { value }])),
  _source: { url: 'https://shop.com/', selector: '.card', scrapedAt: '2026-01-01T00:00:00.000Z' },
});

describe('P1 — precisión de extracción por campo', () => {
  it('dataset perfecto: precision/recall/fill = 1', () => {
    const report = evaluatePrecision({
      expected: [{ fields: { name: 'A', price: 10, link: 'https://x/1' } }],
      actual: [item({ name: 'A', price: '10', link: 'https://x/1' })],
      options: { matchBy: 'link' },
    });
    assert.equal(report.overall.precision, 1);
    assert.equal(report.overall.recall, 1);
    assert.equal(report.overall.f1, 1);
    assert.equal(report.overall.fillRate, 1);
    assert.equal(report.items.matched, 1);
    assert.equal(report.items.extra, 0);
  });

  it('campo ausente baja recall y fillRate; valor erróneo baja precision', () => {
    const report = evaluatePrecision({
      expected: [{ fields: { name: 'A', price: 10, link: 'https://x/1', description: 'D' } }],
      actual: [item({ name: 'A', price: '12', link: 'https://x/1' })],
      options: { matchBy: 'link' },
    });
    assert.equal(report.fields.price.precision, 0);
    assert.equal(report.fields.price.recall, 0);
    assert.equal(report.fields.description.missing, 1);
    assert.equal(report.overall.precision, Number((2 / 3).toFixed(4)));
    assert.equal(report.overall.recall, 0.5);
    assert.equal(report.overall.fillRate, 0.75);
  });

  it('items extra bajan la precision de items; faltantes bajan recall', () => {
    const report = evaluatePrecision({
      expected: [{ fields: { name: 'A' } }, { fields: { name: 'B' } }],
      actual: [item({ name: 'A' }), item({ name: 'B' }), item({ name: 'C' })],
    });
    assert.equal(report.items.actual, 3);
    assert.equal(report.items.matched, 2);
    assert.equal(report.items.extra, 1);
    assert.equal(report.items.precision, Number((2 / 3).toFixed(4)));
    assert.equal(report.items.recall, 1);

    const missing = evaluatePrecision({ expected: [{ fields: { name: 'A' } }, { fields: { name: 'B' } }], actual: [item({ name: 'A' })] });
    assert.equal(missing.items.missing, 1);
    assert.equal(missing.items.recall, 0.5);
    assert.equal(missing.fields.name.missing, 1);
  });

  it('matchBy empareja por identidad y cuenta sobrantes', () => {
    const report = evaluatePrecision({
      expected: [{ fields: { sku: 'S1', name: 'A' } }, { fields: { sku: 'S2', name: 'B' } }],
      actual: [item({ sku: 'S2', name: 'B' }), item({ sku: 'S9', name: 'Z' }), item({ sku: 'S1', name: 'A' })],
      options: { matchBy: 'sku' },
    });
    assert.equal(report.items.matched, 2);
    assert.equal(report.items.extra, 1);
    assert.equal(report.fields.name.correct, 2);
  });

  it('respeta caseInsensitive y tolerancia numérica', () => {
    const report = evaluatePrecision({
      expected: [{ fields: { name: 'Producto A', price: 10.5 } }],
      actual: [item({ name: '  producto   a ', price: 10.7 })],
      options: { caseInsensitive: true, numericTolerance: 0.25 },
    });
    assert.equal(report.fields.name.correct, 1);
    assert.equal(report.fields.price.correct, 1);
    assert.equal(report.overall.precision, 1);
  });
});
