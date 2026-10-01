import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('DSL + CommandValidator (FASE 0-2)', async () => {
  const { ScrapingPlanSchema } = await import('../packages/commands/dist/index.js');
  const { CommandValidator } = await import('../packages/commands/dist/validator.js');

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
});
