import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * FASE 3 — AI Provider Layer (§14-§19) con fetch mockeado. Sin llamadas reales a LLMs.
 */

const PLAN_JSON = JSON.stringify({
  version: '1.0',
  actions: [{ type: 'NAVIGATE', url: 'https://example.com' }, { type: 'FINISH' }],
});

function chatResponse(content, usage) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }], usage }),
    text: async () => content,
  };
}

function errorResponse(status, body = 'error') {
  return { ok: false, status, json: async () => ({}), text: async () => body };
}

let originalFetch;
let calls;

beforeEach(() => {
  originalFetch = global.fetch;
  calls = [];
});

afterEach(() => {
  global.fetch = originalFetch;
});

function mockFetch(handler) {
  global.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return handler(calls.length, { url, init });
  };
}

describe('OpenRouterProvider (§15)', async () => {
  const { OpenRouterProvider } = await import('../libs/infrastructure/ai-providers/dist/openrouter/openrouter.provider.js');

  it('createPlan envía auth/model y parsea JSON + stats', async () => {
    mockFetch(() => chatResponse(PLAN_JSON, { total_tokens: 42 }));
    const p = new OpenRouterProvider({ apiKey: 'sk-test', model: 'm-default', maxRetries: 0 });
    const plan = await p.createPlan({ url: 'https://example.com', instruction: 'x', limits: {} });
    assert.equal(plan.version, '1.0');
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /openrouter\.ai\/api\/v1\/chat\/completions/);
    assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-test');
    assert.equal(calls[0].body.model, 'm-default');
    assert.equal(calls[0].body.temperature, 0.1);
    const stats = p.getLastStats();
    assert.equal(stats.tokens, 42);
    assert.equal(stats.model, 'm-default');
    assert.equal(stats.provider, 'openrouter');
    assert.ok(stats.latencyMs >= 0);
  });

  it('limpia fences ```json y respeta override de modelo (opts > context > config)', async () => {
    mockFetch(() => chatResponse('```json\n' + PLAN_JSON + '\n```'));
    const p = new OpenRouterProvider({ apiKey: 'sk-test', model: 'm-config', maxRetries: 0 });
    await p.createPlan({ url: 'u', instruction: 'i', limits: {}, model: 'm-context' }, { model: 'm-opts' });
    assert.equal(calls[0].body.model, 'm-opts');
    assert.equal(p.getLastStats().model, 'm-opts');
  });

  it('usa context.model cuando no hay opts', async () => {
    mockFetch(() => chatResponse(PLAN_JSON));
    const p = new OpenRouterProvider({ apiKey: 'sk-test', model: 'm-config', maxRetries: 0 });
    await p.createPlan({ url: 'u', instruction: 'i', limits: {}, model: 'm-job' });
    assert.equal(calls[0].body.model, 'm-job');
  });

  it('reintenta ante 429 y luego tiene éxito', async () => {
    mockFetch((n) => (n === 1 ? errorResponse(429, 'rate limited') : chatResponse(PLAN_JSON)));
    const p = new OpenRouterProvider({ apiKey: 'sk-test', model: 'm', maxRetries: 2 });
    const plan = await p.createPlan({ url: 'u', instruction: 'i', limits: {} });
    assert.equal(plan.version, '1.0');
    assert.equal(calls.length, 2);
  });

  it('no reintenta ante 400 y propaga el status', async () => {
    mockFetch(() => errorResponse(400, 'bad request'));
    const p = new OpenRouterProvider({ apiKey: 'sk-test', model: 'm', maxRetries: 3 });
    await assert.rejects(() => p.createPlan({ url: 'u', instruction: 'i', limits: {} }), /OpenRouter 400/);
    assert.equal(calls.length, 1);
  });

  it('falla claro con JSON inválido y con respuesta vacía', async () => {
    mockFetch(() => chatResponse('esto no es json'));
    const p = new OpenRouterProvider({ apiKey: 'sk-test', model: 'm', maxRetries: 0 });
    await assert.rejects(() => p.createPlan({ url: 'u', instruction: 'i', limits: {} }), /no devolvió JSON válido/);

    mockFetch(() => ({ ok: true, status: 200, json: async () => ({ choices: [] }), text: async () => '' }));
    await assert.rejects(() => p.analyzePage({ url: 'u', links: [], elements: [], depth: 0, instruction: 'i' }), /respuesta vacía/);
  });

  it('fromEnv exige API key', async () => {
    const { OpenRouterProvider: P } = await import('../libs/infrastructure/ai-providers/dist/openrouter/openrouter.provider.js');
    const prev = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    assert.throws(() => P.fromEnv(), /OPENROUTER_API_KEY/);
    process.env.OPENROUTER_API_KEY = prev ?? 'sk-restore';
  });
});

describe('CustomEndpointProvider (§16)', async () => {
  const { CustomEndpointProvider } = await import('../libs/infrastructure/ai-providers/dist/custom/custom.provider.js');

  it('usa el endpoint propio y omite Authorization sin apiKey', async () => {
    mockFetch(() => chatResponse(JSON.stringify({ type: 'FINISH' })));
    const p = new CustomEndpointProvider({ endpoint: 'http://ollama:11434/v1/chat/completions', model: 'llama3', maxRetries: 0 });
    const cmds = await p.analyzePage({ url: 'u', links: [], elements: [], depth: 0, instruction: 'i' });
    assert.deepEqual(cmds, [{ type: 'FINISH' }]);
    assert.equal(calls[0].url, 'http://ollama:11434/v1/chat/completions');
    assert.ok(!('Authorization' in calls[0].init.headers));
    assert.equal(calls[0].body.model, 'llama3');
  });

  it('fromEnv exige endpoint', async () => {
    const prev = process.env.AI_CUSTOM_ENDPOINT;
    delete process.env.AI_CUSTOM_ENDPOINT;
    const { CustomEndpointProvider: P } = await import('../libs/infrastructure/ai-providers/dist/custom/custom.provider.js');
    assert.throws(() => P.fromEnv(), /AI_CUSTOM_ENDPOINT/);
    if (prev !== undefined) process.env.AI_CUSTOM_ENDPOINT = prev;
  });
});

describe('Factory + Fallback (§14, §18, §19)', async () => {
  const factory = await import('../libs/infrastructure/ai-providers/dist/provider.factory.js');
  const { FallbackAIProvider } = await import('../libs/infrastructure/ai-providers/dist/fallback.provider.js');

  it('por defecto resuelve openrouter; con AI_PROVIDER=custom resuelve custom', async () => {
    const prevProvider = process.env.AI_PROVIDER;
    const prevKey = process.env.OPENROUTER_API_KEY;
    const prevEndpoint = process.env.AI_CUSTOM_ENDPOINT;
    process.env.OPENROUTER_API_KEY = 'sk-x';
    process.env.AI_CUSTOM_ENDPOINT = 'http://local/v1/chat/completions';
    delete process.env.AI_PROVIDER;
    assert.equal(factory.createAIProvider().name, 'openrouter');
    assert.equal(factory.createAIProviderForJob({ provider: 'custom' }).name, 'custom');
    assert.equal(factory.resolveProviderKind('CUSTOM'), 'custom');
    assert.equal(factory.resolveProviderKind('desconocido'), 'openrouter');
    if (prevProvider !== undefined) process.env.AI_PROVIDER = prevProvider;
    else delete process.env.AI_PROVIDER;
    process.env.OPENROUTER_API_KEY = prevKey ?? '';
    if (prevEndpoint !== undefined) process.env.AI_CUSTOM_ENDPOINT = prevEndpoint;
  });

  it('fallback usa el secundario si el primario falla, y agrega errores si fallan todos', async () => {
    const failing = {
      name: 'primary',
      createPlan: async () => {
        throw new Error('boom primary');
      },
      analyzePage: async () => {
        throw new Error('boom');
      },
      recover: async () => {
        throw new Error('boom');
      },
      interpret: async () => {
        throw new Error('boom');
      },
    };
    const okPlan = { version: '1.0', actions: [] };
    const secondary = {
      name: 'secondary',
      createPlan: async () => okPlan,
      analyzePage: async () => [{ type: 'FINISH' }],
      recover: async () => [{ type: 'FINISH' }],
      interpret: async () => ({}),
      getLastStats: () => ({ latencyMs: 5, model: 'm2', provider: 'secondary' }),
    };
    const fb = new FallbackAIProvider([failing, secondary]);
    assert.equal(fb.name, 'fallback(primary,secondary)');
    assert.deepEqual(await fb.createPlan({}), okPlan);
    assert.equal(fb.getLastStats().provider, 'secondary');

    const allFail = new FallbackAIProvider([failing, { ...failing, name: 'second' }]);
    await assert.rejects(() => allFail.createPlan({}), /All AI providers failed \[createPlan\].*primary.*second/);
  });
});

describe('AIOrchestrator (§20) reenvía opts y cuenta llamadas', async () => {
  const { AIOrchestrator } = await import('../packages/ai/dist/orchestrator/ai-orchestrator.js');

  it('delega con opts y expone providerName/callCount/lastStats', async () => {
    const seen = [];
    const fake = {
      name: 'fake-llm',
      createPlan: async (c, o) => {
        seen.push(['createPlan', o]);
        return { ok: true };
      },
      analyzePage: async (c, o) => {
        seen.push(['analyzePage', o]);
        return [{ type: 'FINISH' }];
      },
      recover: async (c, o) => {
        seen.push(['recover', o]);
        return [];
      },
      interpret: async (c, o) => {
        seen.push(['interpret', o]);
        return {};
      },
      getLastStats: () => ({ latencyMs: 1, model: 'm', provider: 'fake-llm' }),
    };
    const orch = new AIOrchestrator(fake);
    assert.equal(orch.providerName, 'fake-llm');
    await orch.createPlan({ url: 'u', instruction: 'i', limits: {} }, { model: 'm-job' });
    await orch.analyzePage({ url: 'u', links: [], elements: [], depth: 0, instruction: 'i' });
    assert.equal(orch.callCount, 2);
    assert.deepEqual(seen[0], ['createPlan', { model: 'm-job' }]);
    assert.equal(orch.lastStats().provider, 'fake-llm');
  });
});
