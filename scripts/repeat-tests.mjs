#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Detector de tests intermitentes (R-FL-1): repite la suite unitaria N veces y
 * falla si alguna iteración queda en rojo mientras otras están en verde. No es un
 * gate de PR (es lento): se ejecuta a mano antes de un release o al investigar un
 * fallo esporádico. `npm run test:repeat -- 20` para el caso 1-de-20.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const runs = Math.max(2, Number(process.argv[2]) || 5);
const testScript = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts.test;
const files = testScript.split(/\s+/).filter((arg) => arg.endsWith('.test.mjs'));

if (files.length === 0) {
  console.error('[repeat] no se encontraron ficheros de test en el script `test`');
  process.exit(1);
}

// Runner = Vitest (ADR-29); sin cobertura para no repetir el umbral en cada iteración.
const vitestBin = join(root, 'node_modules', '.bin', 'vitest');

console.log(`[repeat] ${runs} iteraciones de ${files.length} ficheros (R-FL-1)`);
let failures = 0;
for (let i = 1; i <= runs; i++) {
  const started = Date.now();
  const result = spawnSync(vitestBin, ['run', ...files], {
    cwd: root,
    stdio: 'inherit',
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (result.status !== 0) {
    failures++;
    console.error(`[repeat] iteración ${i}/${runs} FALLÓ (${seconds}s)`);
  } else {
    console.log(`[repeat] iteración ${i}/${runs} en verde (${seconds}s)`);
  }
}

if (failures > 0) {
  console.error(`[repeat] ${failures}/${runs} iteraciones fallaron → test intermitente (R-FL-1)`);
  process.exit(1);
}
console.log(`[repeat] todas las iteraciones en verde`);
