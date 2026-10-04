import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Normalizador DSL (robustez LLM)', async () => {
  const { normalizeRawCommand, normalizeRawPlan } = await import('../packages/commands/dist/index.js');
  const { CommandValidator } = await import('../packages/commands/dist/validator.js');

  const validator = new CommandValidator({ allowedDomain: 'tienda.com', maxDepth: 3, maxPages: 5 });

  it('normalizeRawCommand corrige action→type, minúsculas y alias', () => {
    const r1 = normalizeRawCommand({ action: 'navigate', url: 'https://tienda.com/' });
    assert.equal(r1.command.type, 'NAVIGATE');

    const r2 = normalizeRawCommand({ action: 'extractList', selector: '.item', maxItems: 30 });
    assert.equal(r2.command.type, 'EXTRACT_LIST');
    assert.equal(r2.command.limit, 30);
    assert.ok(r2.command.fields, 'inyecta fields por defecto');

    const r3 = normalizeRawCommand({ name: 'FINISH' });
    assert.equal(r3.command.type, 'FINISH');

    const r4 = normalizeRawCommand({ type: 'loop', list: 'x' });
    assert.equal(r4.command, null, 'comando inventado → null');
  });

  it('normalizeRawPlan tolera el plan real de un modelo free', () => {
    const modelPlan = {
      version: '1.0',
      actions: [
        { action: 'navigate', url: 'https://tienda.com/', waitForSelector: '.item' },
        { action: 'extractList', selector: '.item, .card', maxItems: 50, paginate: true, nextPageSelector: '.next' },
        { action: 'loop', list: 'products', do: [] },
      ],
    };
    const { actions } = normalizeRawPlan(modelPlan, 'https://tienda.com/');
    assert.deepEqual(actions.map((a) => a.type), ['NAVIGATE', 'EXTRACT_LIST']);
    // Todas validan tras normalizar
    for (const a of actions) validator.validateCommand(a);
  });

  it('normalizeRawPlan NO añade FINISH (permite Fase B dinámica)', () => {
    const { actions } = normalizeRawPlan({ actions: [{ type: 'NAVIGATE', url: 'https://tienda.com/' }] }, 'https://tienda.com/');
    assert.equal(actions.length, 1);
    assert.equal(actions[0].type, 'NAVIGATE');
  });

  it('normalizeRawPlan antepone NAVIGATE si falta', () => {
    const { actions } = normalizeRawPlan([{ type: 'EXTRACT_LIST', selector: '.x', fields: { a: '.a' } }], 'https://tienda.com/');
    assert.equal(actions[0].type, 'NAVIGATE');
    assert.equal(actions[0].url, 'https://tienda.com/');
  });

  it('normalizeRawPlan acepta variants de envoltorio (steps/plan)', () => {
    assert.equal(normalizeRawPlan({ steps: [{ type: 'FINISH' }] }).actions.length, 1);
    assert.equal(normalizeRawPlan({ plan: [{ type: 'FINISH' }] }).actions.length, 1);
  });

  it('clampCommandLimits recorta PAGINATE/FOLLOW_LINKS/EXTRACT_LIST a los topes', async () => {
    const { clampCommandLimits } = await import('../packages/commands/dist/index.js');
    const caps = { maxPages: 5, maxItems: 50 };
    assert.equal(clampCommandLimits({ type: 'PAGINATE', maxPages: 500 }, caps).maxPages, 5);
    assert.equal(clampCommandLimits({ type: 'FOLLOW_LINKS', maxLinks: 500 }, caps).maxLinks, 5);
    assert.equal(clampCommandLimits({ type: 'EXTRACT_LIST', limit: 1000 }, caps).limit, 50);
    // sin valor → fallback acotado
    assert.equal(clampCommandLimits({ type: 'PAGINATE' }, caps).maxPages, 5);
    // comandos sin límites no se tocan
    const fin = clampCommandLimits({ type: 'FINISH' }, caps);
    assert.deepEqual(fin, { type: 'FINISH' });
  });
});
