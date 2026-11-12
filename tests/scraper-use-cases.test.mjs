import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

const { AgentRunner, performRadiography, processJob } = await import('../libs/application/scraper/dist/index.js');
const { InMemoryJobStore } = await import('../libs/infrastructure/storage/dist/memory-store.js');

function makeOrchestrator(overrides = {}) {
  return {
    providerName: 'fake-port',
    cacheHitCount: 0,
    lastCallTokens: () => 0,
    lastStats: () => ({ latencyMs: 1, tokens: 2, model: 'fake-model', provider: 'fake-port' }),
    createPlan: async () => ({
      version: '1.0',
      actions: [
        { type: 'NAVIGATE', url: 'https://shop.com/' },
        { type: 'EXTRACT_LIST', selector: '.card', fields: { name: '.name' } },
        { type: 'FINISH' },
      ],
    }),
    analyzePage: async () => [{ type: 'FINISH' }],
    recover: async () => [{ type: 'FINISH' }],
    interpret: async (ctx) => ctx.rawItems,
    ...overrides,
  };
}

function makeEngine() {
  const state = { visited: [], current: null };
  const calls = [];
  return {
    calls,
    state,
    async execute(command) {
      calls.push(command.type);
      if (command.type === 'NAVIGATE') {
        state.current = command.url;
        state.visited.push(command.url);
        return { ok: true, commandType: 'NAVIGATE' };
      }
      if (command.type === 'EXTRACT_LIST') {
        return {
          ok: true,
          commandType: 'EXTRACT_LIST',
          count: 1,
          items: [{
            name: { value: 'Producto' },
            _source: { url: state.current, selector: '.card', scrapedAt: '2026-01-01T00:00:00.000Z' },
          }],
        };
      }
      return { ok: true, commandType: command.type };
    },
    getMemory: () => ({
      visited: [...state.visited],
      lastUrl: state.current,
      lastItems: 0,
      discoveredSelectors: [],
    }),
    getCurrentUrl: () => state.current,
  };
}

describe('F8 — workflow de scraping con dobles de puertos', () => {
  it('AgentRunner ejecuta el plan contra el puerto ScraperEngine', async () => {
    const engine = makeEngine();
    const runner = new AgentRunner({
      orchestrator: makeOrchestrator(),
      createEngine: () => engine,
      maxSteps: 5,
    });

    const result = await runner.run({
      id: 'job_1',
      url: 'https://shop.com/',
      instruction: 'productos',
      useMemory: false,
    });

    assert.equal(result.status, 'COMPLETED');
    assert.equal(result.items.length, 1);
    assert.deepEqual(engine.calls, ['NAVIGATE', 'EXTRACT_LIST', 'FINISH']);
    assert.deepEqual(result.visitedUrls, ['https://shop.com/']);
    assert.equal(result.providerName, 'fake-port');
  });

  it('processJob persiste artefactos e incrementa el puerto de métricas', async () => {
    const engine = makeEngine();
    const metrics = { counts: {}, inc(name, by = 1) { this.counts[name] = (this.counts[name] ?? 0) + by; } };
    const store = new InMemoryJobStore();
    const job = await store.createJob({ url: 'https://shop.com/', instruction: 'productos' });

    const result = await processJob(job.id, {
      store,
      createOrchestrator: () => makeOrchestrator(),
      createEngine: () => engine,
      metrics,
      allowPrivateHosts: false,
    });

    assert.equal(result.status, 'COMPLETED');
    assert.equal((await store.getJob(job.id)).status, 'COMPLETED');
    assert.equal((await store.getCommands(job.id)).length, 3);
    assert.equal((await store.getResults(job.id)).length, 1);
    assert.equal(metrics.counts.jobs_completed_total, 1);
    assert.equal(metrics.counts.items_extracted_total, 1);
  });

  it('processJob aplica outputSchema.strict y descarta items inválidos', async () => {
    const store = new InMemoryJobStore();
    const job = await store.createJob({
      url: 'https://shop.com/',
      instruction: 'productos',
      outputSchema: {
        strict: true,
        fields: { name: { type: 'string', required: true }, price: { type: 'price', required: true } },
      },
    });
    const result = await processJob(job.id, {
      store,
      createOrchestrator: () => makeOrchestrator(),
      createEngine: () => makeEngine(),
      allowPrivateHosts: false,
    });

    assert.equal(result.status, 'COMPLETED');
    assert.equal(result.items.length, 0);
    assert.equal((await store.getResults(job.id)).length, 0);
    assert.ok((await store.getErrors(job.id)).some((row) => /outputSchema.strict/.test(row.message)));
  });

  it('performRadiography coordina crawler, motor y repositorio sin acoplarse a Mongo', async () => {
    const page = {
      url: 'https://shop.com/',
      title: 'Shop',
      htmlHash: 'new-hash',
      htmlLength: 6000,
      statusCode: 200,
      elementCounts: [{ selector: '.card', count: 2 }],
      links: [
        { text: 'Inicio', href: '/' },
        { text: 'Categorías', href: '/cat' },
        { text: 'Siguiente', href: 'https://shop.com/?page=2' },
      ],
    };
    const updates = [];
    const saved = [];
    const crawler = {
      async crawlDetailed(input) {
        assert.equal(input.url, 'https://www.shop.com/');
        return { pages: [page], stats: { usedBrowser: false, durationMs: 12, pagesOk: 1 } };
      },
    };
    const engine = {
      async execute(command) {
        if (command.type === 'INSPECT_LINKS') {
          return {
            ok: true,
            commandType: command.type,
            items: [
              { text: 'Categorías', href: '/cat' },
              { text: 'Siguiente', href: 'https://shop.com/?page=2' },
            ],
          };
        }
        if (command.type === 'INSPECT_ELEMENTS') {
          return { ok: true, commandType: command.type, items: [{ type: 'product', selector: '.card', text: 'A' }] };
        }
        return { ok: true, commandType: command.type };
      },
      getMemory: () => ({ visited: [], lastUrl: null, lastItems: 0, discoveredSelectors: [] }),
      getCurrentUrl: () => null,
    };
    const repository = {
      async getOrCreateProfile() { return { id: 'profile-1', domain: 'shop.com' }; },
      async updateSelectors(profileId, update) { updates.push({ profileId, update }); },
      async findFreshRadiography() { return { htmlHash: 'old-hash' }; },
      async saveRadiography(input) { saved.push(input); },
    };

    const result = await performRadiography(
      'https://www.shop.com/',
      { maxDepth: 2, maxPages: 5 },
      { crawler, engine, repository },
    );

    assert.equal(result.profile.id, 'profile-1');
    assert.equal(result.changed, true);
    assert.equal(result.discovered.detailSelectors[0].selector, '.card');
    assert.equal(result.discovered.navigationSelectors.length, 1);
    assert.equal(result.discovered.pagination.type, 'query');
    assert.equal(result.discovered.pagination.pattern, 'https://shop.com/?page={n}');
    assert.equal(updates[0].profileId, 'profile-1');
    assert.equal(updates[0].update.isJavaScriptHeavy, false);
    assert.equal(saved[0].htmlHash, 'new-hash');
  });

  it('performRadiography falla si el crawler no devuelve páginas', async () => {
    const engine = {
      execute: async () => ({ ok: true, commandType: 'NOOP' }),
      getMemory: () => ({ visited: [], lastUrl: null, lastItems: 0, discoveredSelectors: [] }),
      getCurrentUrl: () => null,
    };
    await assert.rejects(
      () => performRadiography('https://shop.com/', undefined, {
        crawler: { crawlDetailed: async () => ({ pages: [], stats: { usedBrowser: false, durationMs: 1, pagesOk: 0 } }) },
        engine,
        repository: {
          getOrCreateProfile: async () => ({ id: 'p1' }),
          updateSelectors: async () => {},
          findFreshRadiography: async () => null,
          saveRadiography: async () => {},
        },
      }),
      /No se pudo crawlear/,
    );
  });
});
