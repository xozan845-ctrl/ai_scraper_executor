import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fc from 'fast-check';

/**
 * Property-based tests (R-PB-1..3). Invariantes sobre las funciones puras que
 * procesan la entrada no confiable del modelo (DSL y presupuestos) y la
 * derivación de dominios (allowlist). Complementan los casos fijos de
 * normalize/limits/security.
 */

const core = await import('../libs/domain/execution/dist/index.js');
const { normalizeRawCommand, normalizeRawPlan } = await import('../libs/domain/ai/dist/index.js');
const { normalizeDomain, isAllowedHost, HttpError } = await import('../libs/shared/security/dist/index.js');
const exec = await import('../libs/infrastructure/execution/dist/index.js');

const KEYS = Object.keys(core.DEFAULT_LIMITS);
const DSL_TYPES = [
  'NAVIGATE', 'EXTRACT', 'EXTRACT_LIST', 'FOLLOW_LINKS', 'PAGINATE', 'SCROLL',
  'CLICK', 'TYPE', 'WAIT', 'FINISH', 'AUTHENTICATE', 'GET_ATTRIBUTE',
  'INSPECT_PAGE', 'INSPECT_LINKS', 'INSPECT_ELEMENTS',
];

describe('Property-based (R-PB)', () => {
  it('normalizeJobLimits: entero en [1, HARD] e idempotente para cualquier entrada', () => {
    const valueArb = fc.oneof(
      fc.integer(),
      fc.double(),
      fc.constant(0),
      fc.constant(-1),
      fc.constant(Number.NaN),
      fc.constant(Number.POSITIVE_INFINITY),
    );
    const limitsArb = fc.record(Object.fromEntries(KEYS.map((k) => [k, valueArb])));
    fc.assert(
      fc.property(limitsArb, (input) => {
        const out = core.normalizeJobLimits(input);
        for (const k of KEYS) {
          assert.ok(Number.isInteger(out[k]), `${k} no es entero: ${out[k]}`);
          assert.ok(out[k] >= 1 && out[k] <= core.HARD_LIMITS[k], `${k} fuera de rango: ${out[k]}`);
        }
        assert.deepEqual(core.normalizeJobLimits(out), out, 'no es idempotente');
      }),
      { numRuns: 200 },
    );
  });

  it('normalizeJobLimits: 0, negativo o no finito cae al default (0 no desactiva)', () => {
    fc.assert(
      fc.property(fc.constantFrom(0, -1, -100, Number.NaN, Infinity, -Infinity), (v) => {
        const out = core.normalizeJobLimits({ maxAiTokens: v });
        assert.equal(out.maxAiTokens, core.DEFAULT_LIMITS.maxAiTokens);
      }),
      { numRuns: 50 },
    );
  });

  it('normalizeDomain: idempotente, en minúsculas y sin esquema/path/puerto', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        let once;
        try {
          once = normalizeDomain(s);
        } catch {
          return; // dominio vacío: es un rechazo válido
        }
        assert.equal(normalizeDomain(once), once, 'no es idempotente');
        assert.equal(once, once.toLowerCase());
        assert.ok(!once.includes('://'), 'quedó esquema');
        assert.ok(!once.includes('/'), 'quedó path');
      }),
      { numRuns: 300 },
    );
  });

  it('isAllowedHost: el dominio raíz y sus subdominios están permitidos', () => {
    fc.assert(
      fc.property(fc.domain(), fc.stringMatching(/^[a-z0-9-]{1,20}$/), (domain, sub) => {
        const allowed = normalizeDomain(domain);
        assert.equal(isAllowedHost(allowed, allowed), true);
        assert.equal(isAllowedHost(`${sub}.${allowed}`, allowed), true);
      }),
      { numRuns: 200 },
    );
  });

  it('normalizeRawCommand: nunca produce un type fuera del DSL', () => {
    fc.assert(
      fc.property(fc.string(), (type) => {
        const r = normalizeRawCommand({ type });
        if (r.command) assert.ok(DSL_TYPES.includes(r.command.type), `type fuera del DSL: ${r.command.type}`);
      }),
      { numRuns: 500 },
    );
  });

  it('normalizeRawPlan: solo deja comandos del DSL y antepone NAVIGATE', () => {
    fc.assert(
      fc.property(fc.array(fc.anything()), (actions) => {
        const { actions: out } = normalizeRawPlan(actions);
        for (const a of out) {
          assert.ok(DSL_TYPES.includes(a.type), `type fuera del DSL: ${a.type}`);
        }
        // Si el plan resultante no está vacío, empieza por NAVIGATE (regla del normalizador).
        if (out.length > 0) assert.equal(out[0].type, 'NAVIGATE');
      }),
      { numRuns: 200 },
    );
  });

  it('isRetryableError: 5xx/429 sí, 4xx (no 429) no', () => {
    fc.assert(
      fc.property(fc.integer({ min: 100, max: 599 }), (status) => {
        const retry = exec.isRetryableError(new HttpError('http', status));
        if (status >= 500 || status === 429) assert.equal(retry, true, `${status} debería reintentar`);
        else assert.equal(retry, false, `${status} no debería reintentar`);
      }),
      { numRuns: 300 },
    );
  });

  it('needsBrowserRender: nunca lanza, es determinista y el texto largo no pide render', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const value = exec.needsBrowserRender(s);
        assert.equal(typeof value, 'boolean');
        assert.equal(exec.needsBrowserRender(s), value, 'no determinista');
        if (exec.visibleTextLength(s) >= 500) assert.equal(value, false, 'texto largo pidió render');
      }),
      { numRuns: 300 },
    );
  });

  it('detectChallenge: devuelve null o una clase conocida', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const kind = exec.detectChallenge(s);
        assert.ok(kind === null || ['cloudflare', 'recaptcha', 'hcaptcha'].includes(kind), `clase desconocida: ${kind}`);
      }),
      { numRuns: 300 },
    );
  });

  it('dedupeItems: subconjunto en orden, sin duplicados e idempotente', () => {
    const itemArb = fc.record({ a: fc.string(), b: fc.integer() });
    fc.assert(
      fc.property(fc.array(itemArb), (items) => {
        const out = exec.dedupeItems(items);
        assert.ok(out.length <= items.length);
        let from = 0;
        for (const o of out) {
          const at = items.findIndex((x, i) => i >= from && x === o);
          assert.ok(at >= 0, 'la salida no conserva el orden de la entrada');
          from = at + 1;
        }
        const keys = out.map((o) => exec.itemKey(o));
        assert.equal(new Set(keys).size, keys.length, 'quedaron duplicados');
        assert.equal(exec.dedupeItems(out).length, out.length, 'no es idempotente');
      }),
      { numRuns: 200 },
    );
  });
});
