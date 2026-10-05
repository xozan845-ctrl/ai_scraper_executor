#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const specPath = join(root, 'docs', 'openapi.json');
const port = process.env.OPENAPI_PORT ?? '3210';
const update = process.argv.includes('--update');

/** Ordena claves recursivamente para que la spec versionada sea canónica. */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  }
  return value;
}

async function waitForHealth(url, timeoutMs) {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // aún no escucha; reintentar
    }
    if (Date.now() - start > timeoutMs) throw new Error(`la API no respondió en ${url} tras ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

const child = spawn(process.execPath, ['apps/api/dist/main.js'], {
  cwd: root,
  env: { ...process.env, PORT: port, MONGODB_MOCK: '1' },
  stdio: 'inherit',
});

const base = `http://127.0.0.1:${port}`;
try {
  await waitForHealth(`${base}/api/v1/health`, 60_000);
  const res = await fetch(`${base}/api/v1/docs-json`);
  if (!res.ok) throw new Error(`GET /api/v1/docs-json devolvió ${res.status}`);
  const spec = canonical(await res.json());
  const serialized = `${JSON.stringify(spec, null, 2)}\n`;

  if (update) {
    writeFileSync(specPath, serialized);
    console.log(`[openapi] spec escrita en ${specPath}`);
  } else {
    let current;
    try {
      current = readFileSync(specPath, 'utf8');
    } catch (e) {
      throw new Error(`no existe ${specPath}; ejecuta \`npm run openapi:export\``, { cause: e });
    }
    if (current !== serialized) {
      console.error(`[openapi] ${specPath} está DESINCRONIZADO respecto a la API.`);
      console.error('[openapi] ejecuta `npm run openapi:export` y commitea el resultado.');
      process.exitCode = 1;
    } else {
      console.log('[openapi] spec sincronizada.');
    }
  }
} catch (e) {
  console.error(`[openapi] ${e.message}`);
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
}
