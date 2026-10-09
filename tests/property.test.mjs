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
const { normalizeDomain, isAllowedHost } = await import('../libs/shared/security/dist/index.js');

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
});
