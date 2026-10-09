import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Completitud del DSL (R-AI-2, R-U-12): un `type` nuevo en el enum Zod tiene que
 * existir en el normalizador y en el esquema que se declara al modelo. Sin este
 * test, añadir un comando a `schemas.ts` sin tocar `normalize.ts`/`prompts.ts`
 * pasaría la suite en verde.
 */

const commands = await import('../libs/domain/ai/dist/index.js');
const providers = await import('../libs/infrastructure/ai-providers/dist/index.js');

const TYPES = Object.values(commands.CommandType);

describe('Completitud del DSL (R-AI-2, R-U-12)', () => {
  it('el enum del DSL tiene exactamente 15 comandos', () => {
    assert.equal(TYPES.length, 15, `se esperaban 15 tipos, hay ${TYPES.length}`);
    assert.equal(new Set(TYPES).size, 15, 'hay tipos duplicados en el enum');
  });

  it('cada type sobrevive al normalizador (no se descarta ni muta)', () => {
    for (const type of TYPES) {
      const result = commands.normalizeRawCommand({ type });
      assert.ok(result.command, `${type} fue descartado por el normalizador`);
      assert.equal(result.command.type, type, `${type} mutó a ${result.command.type}`);
    }
  });

  it('cada type aparece en el esquema DSL que se declara al modelo', () => {
    const spec = String(providers.DSL_SPEC);
    for (const type of TYPES) {
      assert.ok(spec.includes(type), `${type} no aparece en DSL_SPEC (prompts)`);
    }
  });

  it('un type inventado se descarta (el normalizador no lo "arregla")', () => {
    const result = commands.normalizeRawCommand({ type: 'LOOP_FOREVER' });
    assert.equal(result.command, null);
  });
});
