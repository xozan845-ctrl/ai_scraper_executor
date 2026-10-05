#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

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
    await new Promise((r) => setTimeout(r, 300));
  }
}

/**
 * Arranca la API compilada y espera a que responda `/api/v1/health`.
 * Devuelve `{ baseUrl, stop }`. Usado por las suites de contrato e integración.
 */
export async function startApi({ port = 3221, env = {}, healthTimeoutMs = 60_000 } = {}) {
  const child = spawn(process.execPath, ['apps/api/dist/main.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), ...env },
    stdio: 'ignore',
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForHealth(`${baseUrl}/api/v1/health`, healthTimeoutMs);
  } catch (e) {
    child.kill('SIGTERM');
    throw e;
  }
  return {
    baseUrl,
    stop: () => child.kill('SIGTERM'),
  };
}
