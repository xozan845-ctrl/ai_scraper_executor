import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Límites del job (§35): normalización con topes duros de servidor y
 * validación del DTO. `maxAiTokens: 0`/vacío NO desactiva el presupuesto.
 */
describe('Límites del job — topes duros y validación', async () => {
  const { DEFAULT_LIMITS, HARD_LIMITS, normalizeJobLimits } = await import('../libs/domain/execution/dist/index.js');
  const { plainToInstance } = await import('class-transformer');
  const { validate } = await import('class-validator');
  const { CreateJobDto } = await import('../apps/api/dist/jobs/dto/create-job.dto.js');

  it('vacío / inválido / <=0 → DEFAULT (maxAiTokens 0 no desactiva presupuesto)', () => {
    const cases = [undefined, null, {}, { maxAiTokens: 0 }, { maxAiTokens: -5 }, { maxPages: NaN }, { maxItems: 0 }];
    for (const c of cases) {
      assert.deepEqual(normalizeJobLimits(c), DEFAULT_LIMITS, `caso ${JSON.stringify(c)}`);
    }
  });

  it('valores enormes → recortados a HARD_LIMITS; decimales truncados', () => {
    const huge = normalizeJobLimits({
      maxPages: 1e9,
      maxDepth: 99,
      maxItems: 1e12,
      maxRuntimeSec: 1e9,
      maxRequests: 1e12,
      maxAiTokens: 1e12,
    });
    assert.deepEqual(huge, HARD_LIMITS);
    assert.equal(normalizeJobLimits({ maxPages: 2.9 }).maxPages, 2);
  });

  it('valores válidos se respetan', () => {
    const n = normalizeJobLimits({ maxPages: 7, maxItems: 50, maxAiTokens: 1000 });
    assert.equal(n.maxPages, 7);
    assert.equal(n.maxItems, 50);
    assert.equal(n.maxAiTokens, 1000);
    assert.equal(n.maxDepth, DEFAULT_LIMITS.maxDepth);
  });

  async function dtoErrors(payload) {
    const dto = plainToInstance(CreateJobDto, payload);
    return validate(dto);
  }

  it('CreateJobDto rechaza límites fuera de rango y ai inválido', async () => {
    const base = { url: 'https://shop.com/', instruction: 'Obtén productos' };
    assert.equal((await dtoErrors(base)).length, 0);
    assert.ok((await dtoErrors({ ...base, limits: { maxPages: 1e9 } })).length > 0, 'maxPages fuera de rango');
    assert.ok((await dtoErrors({ ...base, limits: { maxPages: 0 } })).length > 0, 'maxPages 0 inválido');
    assert.ok((await dtoErrors({ ...base, limits: { maxAiTokens: -1 } })).length > 0, 'maxAiTokens negativo');
    assert.ok((await dtoErrors({ ...base, limits: { maxRuntimeSec: 999999 } })).length > 0, 'maxRuntimeSec fuera de rango');
    assert.ok((await dtoErrors({ ...base, ai: { provider: 'hacker' } })).length > 0, 'proveedor no permitido');
    const ok = await dtoErrors({ ...base, limits: { maxPages: 5, maxAiTokens: 1000 }, ai: { provider: 'openrouter', model: 'x' } });
    assert.equal(ok.length, 0);
  });
});
