import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

// Tests que fijan el contrato literal de `@ai-scraper/domain-execution` para matar
// mutantes de string/objeto (R-MT-3): los valores de `JobStatus`, los presupuestos por
// defecto y los topes duros son contrato persistido, no pueden derivar en silencio.
describe('domain/execution: contrato literal (R-MT-3)', async () => {
  const { JobStatus, DEFAULT_LIMITS, HARD_LIMITS } = await import('../libs/domain/execution/dist/index.js');

  it('los valores del enum JobStatus coinciden con su clave', () => {
    const expected = [
      'CREATED', 'QUEUED', 'PLANNING', 'EXPLORING', 'EXECUTING', 'RECOVERING',
      'INTERPRETING', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT', 'NEEDS_HUMAN',
    ];
    assert.deepEqual(Object.keys(JobStatus), expected);
    for (const key of expected) assert.equal(JobStatus[key], key);
  });

  it('DEFAULT_LIMITS tiene los valores exactos del contrato', () => {
    assert.deepEqual(DEFAULT_LIMITS, {
      maxPages: 100,
      maxDepth: 5,
      maxItems: 10000,
      maxRuntimeSec: 300,
      maxRequests: 1000,
      maxAiTokens: 200000,
    });
  });

  it('HARD_LIMITS tiene los valores exactos del contrato', () => {
    assert.deepEqual(HARD_LIMITS, {
      maxPages: 1000,
      maxDepth: 10,
      maxItems: 100000,
      maxRuntimeSec: 3600,
      maxRequests: 100000,
      maxAiTokens: 5_000_000,
    });
  });
});

describe('domain/execution: normalizeJobLimits bordes (R-MT-3)', async () => {
  const { normalizeJobLimits, DEFAULT_LIMITS, HARD_LIMITS } = await import('../libs/domain/execution/dist/index.js');

  it('sin entrada devuelve los defaults', () => {
    assert.deepEqual(normalizeJobLimits(), DEFAULT_LIMITS);
  });

  it('devuelve cada clave pasada, de forma independiente', () => {
    assert.deepEqual(
      normalizeJobLimits({ maxPages: 7, maxDepth: 3, maxItems: 42, maxRuntimeSec: 11, maxRequests: 13, maxAiTokens: 17 }),
      { maxPages: 7, maxDepth: 3, maxItems: 42, maxRuntimeSec: 11, maxRequests: 13, maxAiTokens: 17 },
    );
  });

  it('no numérico / no finito / <= 0 cae al default', () => {
    assert.equal(normalizeJobLimits({ maxPages: '5' }).maxPages, DEFAULT_LIMITS.maxPages);
    assert.equal(normalizeJobLimits({ maxPages: Number.NaN }).maxPages, DEFAULT_LIMITS.maxPages);
    assert.equal(normalizeJobLimits({ maxPages: Number.POSITIVE_INFINITY }).maxPages, DEFAULT_LIMITS.maxPages);
    assert.equal(normalizeJobLimits({ maxPages: 0 }).maxPages, DEFAULT_LIMITS.maxPages);
    assert.equal(normalizeJobLimits({ maxPages: -5 }).maxPages, DEFAULT_LIMITS.maxPages);
  });

  it('positivo se trunca y nunca sale de [1, HARD_LIMITS]', () => {
    assert.equal(normalizeJobLimits({ maxPages: 1.9 }).maxPages, 1);
    assert.equal(normalizeJobLimits({ maxPages: 5e-324 }).maxPages, 1);
    assert.equal(normalizeJobLimits({ maxPages: HARD_LIMITS.maxPages + 1 }).maxPages, HARD_LIMITS.maxPages);
  });
});

