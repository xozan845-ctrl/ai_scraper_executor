import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

describe('AIOrchestrator caché de respuestas (Etapa 1)', async () => {
  const { AIOrchestrator } = await import('../libs/application/ai/dist/orchestrator/ai-orchestrator.js');
  const { MemoryJsonCache } = await import('../libs/infrastructure/redis/dist/kv.js');

  function fakeProvider() {
    let planCalls = 0;
    return {
      name: 'fake',
      calls: () => planCalls,
      async createPlan() {
        planCalls += 1;
        return { version: '1.0', actions: [{ type: 'FINISH' }] };
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
      getLastStats: () => ({ latencyMs: 1, tokens: 10, model: 'm', provider: 'fake' }),
    };
  }

  it('cachea createPlan por contexto (2ª llamada no toca el proveedor)', async () => {
    const p = fakeProvider();
    const orch = new AIOrchestrator(p, new MemoryJsonCache());
    const ctx = { url: 'https://x.com', instruction: 'productos', limits: {} };
    await orch.createPlan(ctx);
    await orch.createPlan(ctx);
    assert.equal(p.calls(), 1, 'solo una llamada real al proveedor');
    assert.equal(orch.cacheHitCount, 1);
  });

  it('contextos distintos no comparten caché', async () => {
    const p = fakeProvider();
    const orch = new AIOrchestrator(p, new MemoryJsonCache());
    await orch.createPlan({ url: 'https://x.com', instruction: 'a', limits: {} });
    await orch.createPlan({ url: 'https://x.com', instruction: 'b', limits: {} });
    assert.equal(p.calls(), 2);
    assert.equal(orch.cacheHitCount, 0);
  });

  it('sin caché, siempre llama al proveedor', async () => {
    const p = fakeProvider();
    const orch = new AIOrchestrator(p);
    const ctx = { url: 'https://x.com', instruction: 'p', limits: {} };
    await orch.createPlan(ctx);
    await orch.createPlan(ctx);
    assert.equal(p.calls(), 2);
  });
});
