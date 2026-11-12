#!/usr/bin/env node
/**
 * CLI de precisión (P1). Uso:
 *   node scripts/precision.mjs tests/fixtures/precision/products.json
 * Umbral opcional: PRECISION_MIN=0.9 (compara el F1 global).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluatePrecision } from '../libs/application/scraper/dist/index.js';

const file = process.argv[2];
if (!file) {
  console.error('Uso: node scripts/precision.mjs <dataset.json>');
  process.exit(2);
}

let dataset;
try {
  dataset = JSON.parse(readFileSync(resolve(file), 'utf8'));
} catch (error) {
  console.error(`No se pudo leer ${file}: ${error.message}`);
  process.exit(2);
}

const report = evaluatePrecision(dataset);
const pct = (value) => `${(value * 100).toFixed(2)}%`;

console.log(`[precision] ${file}`);
console.log(`items: expected=${report.items.expected} actual=${report.items.actual} matched=${report.items.matched} missing=${report.items.missing} extra=${report.items.extra}`);
console.log(`items precision=${pct(report.items.precision)} recall=${pct(report.items.recall)} f1=${pct(report.items.f1)}`);
console.log('campos:');
for (const [field, metric] of Object.entries(report.fields)) {
  console.log(`  ${field}: precision=${pct(metric.precision)} recall=${pct(metric.recall)} missing=${metric.missing} wrong=${metric.wrong}`);
}
console.log(`overall: precision=${pct(report.overall.precision)} recall=${pct(report.overall.recall)} f1=${pct(report.overall.f1)} fill=${pct(report.overall.fillRate)} wrong=${pct(report.overall.wrongValueRate)}`);

const min = Number(process.env.PRECISION_MIN ?? '0');
if (Number.isFinite(min) && min > 0 && report.overall.f1 < min) {
  console.error(`[precision] F1 ${pct(report.overall.f1)} < mínimo ${pct(min)}`);
  process.exit(1);
}
