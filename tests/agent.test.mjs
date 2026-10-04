import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * FASE 4 (Planner) + FASE 5 (AgentRunner) + FASE 6 (Recovery).
 * LLM simulado (fake) + HTTP simulado (fetcher mock). Sin red ni claves.
 */

const SHOP_HTML = `<!doctype html><html><head><title>Tienda Demo</title></head><body>
<a href="/cat/electronica">Electrónica</a>
<div class="product-card"><span class="name">Prod Uno</span><span class="price">$10</span></div>
<div class="product-card"><span class="name">Prod Dos</span><span class="price">$20</span></div>
</body></html>`;

const EXTRACT_OK = {
  type: 'EXTRACT_LIST',
  selector: '.product-card',
  fields: { name: '.name', price: '.price' },
};

function makeFake({ plan = null, decisions = [], recoveries = [], planError = null } = {}) {
  const calls = { createPlan: [], analyzePage: [], recover: [] };
  const fake = {
    name: 'fake-llm',
    async createPlan(ctx, opts) {
      calls.createPlan.push({ ctx, opts });
      if (planError) throw new Error(planError);
      return structuredClone(plan);
    },
    async analyzePage(ctx, opts) {
      calls.analyzePage.push({ ctx, opts });
      const d = decisions.shift();
      if (d instanceof Error) throw d;
      if (d === undefined) throw new Error('fake sin más decisiones');
      return [structuredClone(d)];
    },
    async recover(ctx, opts) {
      calls.recover.push({ ctx, opts });
      const r = recoveries.shift();
      if (r instanceof Error) throw r;
      if (r === undefined) throw new Error('fake sin alternativa de recovery');
      return [structuredClone(r)];
    },
    async interpret(ctx) {
      return ctx.rawItems;
    },
    getLastStats: () => ({ latencyMs: 1, model: 'fake-model', provider: 'fake-llm' }),
  };
  return { fake, calls };
}

function makeFetcher(html = SHOP_HTML) {
  const urls = [];
  const fetcher = async (url) => {
    urls.push(url);
    return html;
  };
  return { fetcher, urls };
}

describe('AI Planner FASE 4 (§21.1)', async () => {
  const { generatePlan } = await import('../apps/worker/dist/planner.js');
  const { AIOrchestrator } = await import('../packages/ai/dist/orchestrator/ai-orchestrator.js');

  it('antepone NAVIGATE si el LLM lo omite', async () => {
    const { fake } = makeFake({ plan: { version: '1.0', actions: [{ ...EXTRACT_OK }] } });
    const plan = await generatePlan(
      { url: 'https://tienda.com/', instruction: 'Obtén productos' },
      { orchestrator: new AIOrchestrator(fake) },
    );
    assert.equal(plan.actions[0].type, 'NAVIGATE');
    assert.equal(plan.actions[0].url, 'https://tienda.com/');
    assert.equal(plan.providerName, 'fake-llm');
  });

  it('recorta PAGINATE/EXTRACT_LIST a los límites del job (la IA no eleva límites §35)', async () => {
    const { fake } = makeFake({
      plan: {
        version: '1.0',
        actions: [
          { type: 'NAVIGATE', url: 'https://tienda.com/' },
          { type: 'PAGINATE', pattern: 'https://tienda.com/?page=N', maxPages: 500 },
          { ...EXTRACT_OK, limit: 1000 },
        ],
      },
    });
    const plan = await generatePlan(
      { url: 'https://tienda.com/', instruction: 'x', limits: { maxPages: 7, maxItems: 50 } },
      { orchestrator: new AIOrchestrator(fake) },
    );
    assert.equal(plan.actions[1].maxPages, 7);
    assert.equal(plan.actions[2].limit, 50);
  });

  it('rechaza NAVIGATE fuera del dominio y envuelve el error con el proveedor', async () => {
    const { fake } = makeFake({
      plan: { version: '1.0', actions: [{ type: 'NAVIGATE', url: 'https://evil.com/robalo' }] },
    });
    await assert.rejects(
      generatePlan(
        { url: 'https://tienda.com/', instruction: 'x' },
        { orchestrator: new AIOrchestrator(fake) },
      ),
      /dominio permitido/,
    );

    const { fake: failing } = makeFake({ planError: 'LLM caído' });
    await assert.rejects(
      generatePlan(
        { url: 'https://tienda.com/', instruction: 'x' },
        { orchestrator: new AIOrchestrator(failing) },
      ),
      /Planificación fallida \(fake-llm\): LLM caído/,
    );
  });

  it('reenvía el modelo del job al proveedor (§18)', async () => {
    const { fake, calls } = makeFake({
      plan: { version: '1.0', actions: [{ type: 'NAVIGATE', url: 'https://tienda.com/' }] },
    });
    await generatePlan(
      { url: 'https://tienda.com/', instruction: 'x', ai: { provider: 'custom', model: 'job-model' } },
      { orchestrator: new AIOrchestrator(fake) },
    );
    assert.deepEqual(calls.createPlan[0].opts, { model: 'job-model' });
    assert.equal(calls.createPlan[0].ctx.model, 'job-model');
  });
});

describe('AgentRunner FASE 5 + Recovery FASE 6 (§47, §28)', async () => {
  const { AgentRunner } = await import('../apps/worker/dist/agent-runner.js');
  const { AIOrchestrator } = await import('../packages/ai/dist/orchestrator/ai-orchestrator.js');
  const { ExecutionEngine } = await import('../packages/execution-engine/dist/execution-engine.js');

  const baseJob = {
    id: 'job_test',
    url: 'https://tienda.com/productos',
    instruction: 'Obtén todos los productos',
  };

  function runner(fake, fetcher, opts = {}) {
    return new AgentRunner({
      orchestrator: new AIOrchestrator(fake),
      createEngine: () => new ExecutionEngine({ fetcher }),
      maxSteps: 10,
      maxRecoveryAttempts: 2,
      ...opts,
    });
  }

  it('ruta feliz: plan NAVIGATE→EXTRACT_LIST→FINISH con trazabilidad', async () => {
    const { fake } = makeFake({
      plan: {
        version: '1.0',
        actions: [{ type: 'NAVIGATE', url: baseJob.url }, { ...EXTRACT_OK }, { type: 'FINISH' }],
      },
    });
    const { fetcher } = makeFetcher();
    const res = await runner(fake, fetcher).run(baseJob);
    assert.equal(res.status, 'COMPLETED');
    assert.equal(res.items.length, 2);
    assert.equal(res.items[0].name.value, 'Prod Uno');
    assert.ok(res.items[0]._source.url.includes('tienda.com'));
    assert.deepEqual(
      res.steps.map((s) => s.command.type),
      ['NAVIGATE', 'EXTRACT_LIST', 'FINISH'],
    );
    assert.equal(res.recoveryCount, 0);
    assert.equal(res.providerName, 'fake-llm');
  });

  it('bucle dinámico: plan corto + analyzePage decide EXTRACT y FINISH', async () => {
    const { fake, calls } = makeFake({
      plan: { version: '1.0', actions: [{ type: 'NAVIGATE', url: baseJob.url }] },
      decisions: [{ ...EXTRACT_OK }, { type: 'FINISH' }],
    });
    const { fetcher } = makeFetcher();
    const res = await runner(fake, fetcher).run(baseJob);
    assert.equal(res.status, 'COMPLETED');
    assert.equal(res.items.length, 2);
    assert.equal(calls.analyzePage.length, 2);
    // El contexto observado incluye links/elementos reales de la página.
    assert.ok(calls.analyzePage[0].ctx.links.length >= 1);
    assert.ok(calls.analyzePage[0].ctx.elements.length >= 1);
  });

  it('Fase B no permite elevar límites (clamp §35)', async () => {
    const { fake } = makeFake({
      plan: { version: '1.0', actions: [{ type: 'NAVIGATE', url: baseJob.url }] },
      decisions: [
        { type: 'EXTRACT_LIST', selector: '.product-card', fields: { name: '.name' }, limit: 1000 },
        { type: 'FINISH' },
      ],
    });
    const { fetcher } = makeFetcher();
    const res = await runner(fake, fetcher).run({ ...baseJob, limits: { maxItems: 5 } });
    const extract = res.steps.find((s) => s.command.type === 'EXTRACT_LIST');
    assert.ok(extract, 'debe haber un paso EXTRACT_LIST');
    assert.equal(extract.command.limit, 5, 'limit debe recortarse a maxItems');
  });

  it('maxRuntimeSec acota el runtime del job (deadline)', async () => {
    const { fake } = makeFake({
      plan: { version: '1.0', actions: [{ type: 'NAVIGATE', url: baseJob.url }] },
    });
    const { fetcher } = makeFetcher();
    const res = await runner(fake, fetcher).run({ ...baseJob, limits: { maxRuntimeSec: 0 } });
    assert.equal(res.status, 'FAILED');
    assert.match(res.error, /maxRuntimeSec/);
  });

  it('maxAiTokens corta la ejecución al superar el presupuesto', async () => {
    // Fake que reporta tokens altos por llamada.
    const calls = { createPlan: 0 };
    const tokenFake = {
      name: 'fake-llm',
      async createPlan() {
        calls.createPlan += 1;
        return { version: '1.0', actions: [{ type: 'NAVIGATE', url: baseJob.url }] };
      },
      async analyzePage() {
        return [{ type: 'FINISH' }];
      },
      async recover() {
        return [{ type: 'FINISH' }];
      },
      async interpret(c) {
        return c.rawItems;
      },
      getLastStats: () => ({ latencyMs: 1, tokens: 100, model: 'm', provider: 'fake-llm' }),
    };
    const { fetcher } = makeFetcher();
    const res = await runner(tokenFake, fetcher).run({ ...baseJob, limits: { maxAiTokens: 50 } });
    assert.equal(res.status, 'FAILED');
    assert.match(res.error, /Presupuesto IA/);
  });

  it('recovery: selector fallido → alternativa del LLM → éxito con recoveryCount=1', async () => {
    const { fake, calls } = makeFake({
      plan: {
        version: '1.0',
        actions: [
          { type: 'NAVIGATE', url: baseJob.url },
          { type: 'EXTRACT_LIST', selector: '.no-existe', fields: { a: '.x' } },
          { type: 'FINISH' },
        ],
      },
      recoveries: [{ ...EXTRACT_OK }],
    });
    const { fetcher } = makeFetcher();
    const res = await runner(fake, fetcher).run(baseJob);
    assert.equal(res.status, 'COMPLETED');
    assert.equal(res.recoveryCount, 1);
    assert.equal(res.items.length, 2);
    assert.equal(res.steps[1].recovered, true);
    // El contexto de recovery incluye el comando fallido y el error.
    assert.ok(calls.recover[0].ctx.failedCommand);
    assert.ok(calls.recover[0].ctx.error);
  });

  it('recovery agotado: FAILED explicativo sin reintentos infinitos', async () => {
    const { fake, calls } = makeFake({
      plan: {
        version: '1.0',
        actions: [
          { type: 'NAVIGATE', url: baseJob.url },
          { type: 'EXTRACT_LIST', selector: '.no-existe', fields: { a: '.x' } },
        ],
      },
      recoveries: [new Error('LLM caído'), new Error('LLM caído')],
    });
    const { fetcher } = makeFetcher();
    const res = await runner(fake, fetcher, { maxRecoveryAttempts: 2 }).run(baseJob);
    assert.equal(res.status, 'FAILED');
    assert.match(res.error, /recovery agotado/);
    assert.equal(calls.recover.length, 2);
  });

  it('el validador frena en el loop: NAVIGATE a evil.com nunca se ejecuta', async () => {
    const { fake } = makeFake({
      plan: { version: '1.0', actions: [{ type: 'NAVIGATE', url: baseJob.url }] },
      decisions: [{ type: 'NAVIGATE', url: 'https://evil.com/robalo' }],
      recoveries: [{ type: 'FINISH' }],
    });
    const { fetcher, urls } = makeFetcher();
    const res = await runner(fake, fetcher).run(baseJob);
    assert.equal(res.status, 'COMPLETED');
    assert.equal(res.recoveryCount, 1);
    assert.ok(!urls.some((u) => u.includes('evil.com')), 'evil.com no debe ser fetched');
  });

  it('maxSteps acota el loop sin FINISH', async () => {
    const { fake } = makeFake({
      plan: { version: '1.0', actions: [{ type: 'NAVIGATE', url: baseJob.url }] },
      decisions: Array.from({ length: 10 }, () => ({ type: 'INSPECT_PAGE' })),
    });
    const { fetcher } = makeFetcher();
    const res = await runner(fake, fetcher, { maxSteps: 4 }).run(baseJob);
    assert.equal(res.status, 'FAILED');
    assert.match(res.error, /maxSteps \(4\)/);
    assert.equal(res.steps.length, 4);
  });
});
