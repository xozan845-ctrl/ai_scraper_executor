/**
 * Harness mínimo para los escenarios (sin dependencias).
 * Uso: `import { t, waitFor } from '../harness.mjs'`.
 */

export const t = {
  step: (m) => console.log(`\n== ${m}`),
  ok: (m) => console.log(`   [OK] ${m}`),
  info: (m) => console.log(`   ${m}`),
  warn: (m) => console.log(`   [!] ${m}`),
  assert(cond, msg) {
    if (!cond) throw new Error(msg || 'assertion failed');
    console.log(`   [OK] ${msg}`);
  },
  /** Verifica que `fn` falle; opcionalmente que el mensaje case con `re`. */
  async expectFail(fn, re) {
    let threw = false;
    try {
      await fn();
    } catch (e) {
      threw = true;
      if (re && !re.test(e.message)) throw new Error(`error inesperado: ${e.message}`, { cause: e });
      console.log(`   [OK] error esperado: ${e.message.split('\n')[0]}`);
    }
    if (!threw) throw new Error('se esperaba un error pero la llamada tuvo éxito');
  },
};

/** Reintenta `fn` hasta que devuelva algo truthy o se agote el timeout. */
export async function waitFor(fn, { timeoutMs = 240000, intervalMs = 3000 } = {}) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`timeout tras ${Math.round(timeoutMs / 1000)}s`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Lee JSON desde una variable de entorno sin imprimir secretos. */
export function readJsonEnv(name, fallback = null) {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`${name} no contiene JSON válido: ${e.message}`, { cause: e });
  }
}
