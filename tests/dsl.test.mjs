import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

describe('DSL + CommandValidator (FASE 0-2)', async () => {
  const { ScrapingPlanSchema } = await import('../libs/domain/ai/dist/index.js');
  const { CommandValidator } = await import('../libs/domain/ai/dist/validator.js');

  it('acepta plan NAVIGATE + EXTRACT_LIST válido', () => {
    const plan = ScrapingPlanSchema.parse({
      version: '1.0',
      actions: [
        { type: 'NAVIGATE', url: 'https://example.com' },
        {
          type: 'EXTRACT_LIST',
          selector: '.product-card',
          fields: { name: '.name', price: '.price', image: { selector: 'img', attribute: 'src' } },
        },
        { type: 'FINISH' },
      ],
    });
    assert.equal(plan.actions.length, 3);
  });

  it('bloquea SSRF a hosts privados', () => {
    const v = new CommandValidator({ allowedDomain: 'example.com', maxDepth: 5, maxPages: 100 });
    assert.throws(() => v.validateCommand({ type: 'NAVIGATE', url: 'http://169.254.169.254/latest' }));
  });

  it('bloquea URLs fuera del dominio', () => {
    const v = new CommandValidator({ allowedDomain: 'example.com', maxDepth: 5, maxPages: 100 });
    assert.throws(() => v.validateCommand({ type: 'NAVIGATE', url: 'https://evil.com/x' }));
  });

  it('rechaza comando desconocido', () => {
    const v = new CommandValidator({ allowedDomain: 'example.com', maxDepth: 5, maxPages: 100 });
    assert.throws(() => v.validateCommand({ type: 'DROP_TABLE' }));
  });

  it('rechaza campos ajenos al DSL y parámetros incompletos', () => {
    const v = new CommandValidator({ allowedDomain: 'example.com', maxDepth: 5, maxPages: 5 });
    assert.throws(() => v.validateCommand({ type: 'FINISH', eval: 'process.exit()' }));
    assert.throws(() => v.validateCommand({ type: 'GET_ATTRIBUTE', selector: 'a' }));
    assert.throws(() => v.validateCommand({ type: 'WAIT', ms: 5001 }));
  });

  it('impide que PAGINATE y FOLLOW_LINKS eleven el presupuesto del job', () => {
    const v = new CommandValidator({ allowedDomain: 'example.com', maxDepth: 5, maxPages: 5 });
    assert.throws(() => v.validateCommand({ type: 'PAGINATE', pattern: '?page={n}', maxPages: 6 }));
    assert.throws(() => v.validateCommand({ type: 'FOLLOW_LINKS', selector: 'a', maxLinks: 6 }));
  });
});
