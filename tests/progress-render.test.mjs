import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';

const { AgentRunner } = await import('../libs/application/scraper/dist/index.js');
const { publishProgress, subscribeProgress, __resetProgressBus } = await import('../libs/infrastructure/redis/dist/index.js');

function makeEngine() {
  return {
    async execute(command) {
      if (command.type === 'FINISH') return { ok: true, commandType: 'FINISH' };
      if (command.type === 'NAVIGATE') return { ok: true, commandType: 'NAVIGATE' };
      return { ok: true, commandType: command.type, count: 1, items: [{ name: 'A', _source: { url: 'https://shop.com/', selector: '.x', scrapedAt: '2026-01-01T00:00:00.000Z' } }] };
    },
    getMemory: () => ({ visited: ['https://shop.com/'], lastUrl: 'https://shop.com/', lastItems: 1, discoveredSelectors: [] }),
    getCurrentUrl: () => 'https://shop.com/',
  };
}

function makeOrchestrator() {
  return {
    providerName: 'fake',
    cacheHitCount: 0,
    lastCallTokens: () => 0,
    lastStats: () => null,
    createPlan: async () => ({ version: '1.0', actions: [{ type: 'NAVIGATE', url: 'https://shop.com/' }] }),
    analyzePage: async () => [{ type: 'FINISH' }],
    recover: async () => [{ type: 'FINISH' }],
    interpret: async (ctx) => ctx.rawItems,
  };
}

describe('Progreso en vivo (SSE) y render configurable', () => {
  const OLD_ENV = { ...process.env };
  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    process.env.PROGRESS_BUS_MEMORY = '1';
    __resetProgressBus();
  });
  afterEach(() => {
    process.env = { ...OLD_ENV };
    __resetProgressBus();
  });

  it('el bus entrega eventos por job y la limpieza corta la suscripción', async () => {
    const received = [];
    const off = await subscribeProgress('job_bus', (event) => received.push(event));
    await publishProgress({ type: 'observe', jobId: 'job_bus', at: '2026-01-01T00:00:00.000Z', step: 1 });
    await publishProgress({ type: 'step', jobId: 'job_bus', at: '2026-01-01T00:00:01.000Z', step: 1, ok: true });
    assert.deepEqual(received.map((event) => event.type), ['observe', 'step']);

    off();
    await publishProgress({ type: 'job.finished', jobId: 'job_bus', at: '2026-01-01T00:00:02.000Z' });
    assert.equal(received.length, 2);
  });

  it('AgentRunner se detiene en NEEDS_HUMAN sin entrar en recovery', async () => {
    const engine = {
      async execute() {
        return { ok: false, commandType: 'NAVIGATE', needsHuman: true, challenge: 'recaptcha', error: 'captcha' };
      },
      getMemory: () => ({ visited: [], lastUrl: null, lastItems: 0, discoveredSelectors: [] }),
      getCurrentUrl: () => 'https://shop.com/',
    };
    const runner = new AgentRunner({
      orchestrator: makeOrchestrator(),
      createEngine: () => engine,
      maxSteps: 5,
    });
    const result = await runner.run({
      id: 'job_human',
      url: 'https://shop.com/',
      instruction: 'x',
      useMemory: false,
    });
    assert.equal(result.status, 'NEEDS_HUMAN');
    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0].needsHuman, true);
    assert.equal(result.steps[0].challenge, 'recaptcha');
  });

  it('AgentRunner emite started/observe/decision/step/finished', async () => {
    const events = [];
    const runner = new AgentRunner({
      orchestrator: makeOrchestrator(),
      createEngine: () => makeEngine(),
      maxSteps: 3,
      onProgress: (event) => events.push(event),
    });
    const result = await runner.run({
      id: 'job_progress',
      url: 'https://shop.com/',
      instruction: 'productos',
      useMemory: false,
    });
    assert.equal(result.status, 'COMPLETED');
    const types = new Set(events.map((event) => event.type));
    for (const expected of ['job.started', 'observe', 'decision', 'step', 'job.finished']) {
      assert.ok(types.has(expected), `falta evento ${expected}`);
    }
    const finished = events.find((event) => event.type === 'job.finished');
    assert.equal(finished.status, 'COMPLETED');
    assert.equal(finished.itemsCount, 0);
  });
});
