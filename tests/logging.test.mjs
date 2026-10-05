import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Logging estructurado (§38) sin fuga de datos (§37): el engine no debe volcar
 * los valores extraídos (PII/credenciales) a los logs; solo conteos y metadatos.
 */
describe('Logging del engine no filtra valores extraídos', async () => {
  const { ExecutionEngine } = await import('../packages/execution-engine/dist/index.js');
  const SECRET = 'VALOR_SECRETO_12345';
  const html = `<!doctype html><html><head><title>t</title></head><body>
    <div class="card"><span class="name">${SECRET}</span><span class="price">$9.99</span></div>
  </body></html>`;

  async function capture(fn) {
    const lines = [];
    const orig = console.log;
    console.log = (...args) => void lines.push(args.map(String).join(' '));
    const prevLevel = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = 'debug';
    try {
      await fn();
    } finally {
      console.log = orig;
      if (prevLevel === undefined) delete process.env.LOG_LEVEL;
      else process.env.LOG_LEVEL = prevLevel;
    }
    return lines.join('\n');
  }

  it('EXTRACT_LIST: registra el evento pero no los valores', async () => {
    const out = await capture(async () => {
      const engine = new ExecutionEngine({ fetcher: async () => html });
      await engine.execute({ type: 'NAVIGATE', url: 'https://tienda.com/' });
      await engine.execute({ type: 'EXTRACT_LIST', selector: '.card', fields: { name: '.name', price: '.price' } });
    });
    assert.ok(out.includes('extract_list.done'), 'debe emitir el evento estructurado');
    assert.ok(!out.includes(SECRET), 'los valores extraídos no deben aparecer en los logs');
  });

  it('EXTRACT: no vuelca el objeto de resultado', async () => {
    const out = await capture(async () => {
      const engine = new ExecutionEngine({ fetcher: async () => html });
      await engine.execute({ type: 'NAVIGATE', url: 'https://tienda.com/' });
      await engine.execute({ type: 'EXTRACT', fields: { name: '.name' } });
    });
    assert.ok(!out.includes(SECRET), 'los valores extraídos no deben aparecer en los logs');
  });
});
