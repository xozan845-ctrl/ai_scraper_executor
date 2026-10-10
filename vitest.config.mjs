import { defineConfig } from 'vitest/config';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Carga `.env` (si existe) en process.env antes de los tests — sustituye a
// `node --env-file-if-exists=.env` (ADR-29). En CI sin `.env` no hace nada.
const envPath = join(process.cwd(), '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && !(match[1] in process.env)) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
}

export default defineConfig({
  test: {
    include: ['tests/**/*.test.mjs'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Serial a propósito: Crawlee usa almacenamiento local en disco (ADR-04, R-FL-5).
    fileParallelism: false,
    isolate: true,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // El `dist` se carga como JS externo: sin transformar por Vite, la cobertura
    // se mide sobre el JS compilado (como la nativa de Node), no sobre las fuentes TS.
    server: { deps: { external: [/[\\/]dist[\\/]/] } },
    reporters: [
      'default',
      ['junit', { outputFile: process.env.VITEST_JUNIT_OUTPUT_FILE ?? 'test-results.xml' }],
    ],
    coverage: {
      provider: 'v8',
      // Vitest/Vite mapea la cobertura a los fuentes TS (por los sourcemaps del
      // `dist`); la base cambia de JS compilado a TS → umbrales re-medidos (ADR-29).
      exclude: ['**/node_modules/**', '**/*.module.ts', '**/*.module.js', '**/main.ts', '**/main.js', '**/dto/**'],
      reporter: ['text', 'text-summary'],
      thresholds: { lines: 65, branches: 54, functions: 56 },
    },
  },
});
