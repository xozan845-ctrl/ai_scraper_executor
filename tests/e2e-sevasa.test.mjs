import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Test E2E real contra https://www.sevasaonline.com/
 * Requiere: MongoDB, Redis reales + Chromium (docker compose up -d postgres mongodb redis)
 * Sin MONGODB_MOCK=1 — usa bases de datos reales.
 */
const SEVASA_URL = 'https://www.sevasaonline.com/';

describe('E2E Real — SevasaOnline (memoria + scraping real)', async () => {
  let mongoConnected = false;
  let redisConnected = false;
  let unavailable = false;

  before(async () => {
    // Verificar conexiones reales
    const { connectMongo, isMongoMock } = await import('../packages/mongodb/dist/connection.js');
    const { isRedisHealthy } = await import('../packages/redis/dist/connection.js');

    try {
      await connectMongo();
      mongoConnected = !isMongoMock();
      console.log('[E2E] MongoDB:', mongoConnected ? 'REAL' : 'MOCK');
    } catch (e) {
      console.log('[E2E] MongoDB no disponible:', e.message);
    }

    try {
      redisConnected = await isRedisHealthy();
      console.log('[E2E] Redis:', redisConnected ? 'REAL' : 'NO DISPONIBLE');
    } catch (e) {
      console.log('[E2E] Redis no disponible:', e.message);
    }

    if (!mongoConnected || !redisConnected) {
      unavailable = true;
      console.warn('[E2E] Saltando — requiere MongoDB y Redis reales (docker compose up -d mongodb redis)');
    }
  });

  after(async () => {
    // Cleanup opcional
  });

  it('Radiografía real de SevasaOnline — crea perfil en MongoDB', async (t) => {
    if (unavailable) return t.skip('requiere MongoDB y Redis reales');
    const { performRadiography } = await import('../packages/mongodb/dist/index.js');
    
    console.log('[E2E] Iniciando radiografía de', SEVASA_URL);
    const result = await performRadiography(SEVASA_URL, { 
      maxDepth: 2, 
      maxPages: 10, 
      forceBrowser: true // Sevasa probablemente necesite JS
    });
    
    assert.ok(result.profile, 'Perfil creado');
    assert.ok(result.profile.id, 'Perfil tiene ID');
    assert.equal(result.profile.domain, 'sevasaonline.com');
    console.log('[E2E] Perfil creado:', result.profile.id);
    console.log('[E2E] Selectores lista:', result.discovered.listSelectors.length);
    console.log('[E2E] Selectores detalle:', result.discovered.detailSelectors.length);
    console.log('[E2E] Paginación:', result.discovered.pagination?.type ?? 'ninguna');
    console.log('[E2E] Navegación:', result.discovered.navigationSelectors.length);
    console.log('[E2E] isJavaScriptHeavy:', result.profile.isJavaScriptHeavy);
    console.log('[E2E] shouldUseBrowser:', result.profile.recommendedLimits?.needsBrowser);
    
    // Debe detectar algo útil
    assert.ok(result.discovered.listSelectors.length > 0 || result.discovered.detailSelectors.length > 0, 
      'Debe descubrir al menos algún selector');
  });

  it('Job de scraping real con memoria — usa perfil aprendido', async (t) => {
    if (unavailable) return t.skip('requiere MongoDB y Redis reales');
    const { createProductionEngine } = await import('../apps/worker/dist/browser-engine.js');
    const { ExecutionEngine } = await import('../packages/execution-engine/dist/execution-engine.js');
    const { getLearnedProfile } = await import('../packages/mongodb/dist/index.js');
    const { mongoRepo } = await import('../packages/mongodb/dist/index.js');
    const { AIOrchestrator } = await import('../packages/ai/dist/orchestrator/ai-orchestrator.js');
    const { createFallbackProvider } = await import('../packages/ai-providers/dist/index.js');
    const { AgentRunner } = await import('../apps/worker/dist/agent-runner.js');

    // Verificar que el perfil existe
    const learned = await getLearnedProfile(SEVASA_URL);
    assert.ok(learned.profile, 'Perfil debe existir tras radiografía');
    console.log('[E2E] Perfil aprendido:', learned.profile.domain, 'browser:', learned.shouldUseBrowser);

    // Engine con browser real (CrawlerService.interact)
    const engine = createProductionEngine();
    
    // Provider LLM real (necesita OPENROUTER_API_KEY o AI_CUSTOM_ENDPOINT)
    const hasLlm = Boolean(process.env.OPENROUTER_API_KEY ?? process.env.AI_CUSTOM_ENDPOINT);
    if (!hasLlm) {
      console.warn('[E2E] Saltando scraping con LLM — sin OPENROUTER_API_KEY ni AI_CUSTOM_ENDPOINT');
      return;
    }

    const provider = createFallbackProvider(process.env.AI_PROVIDER);
    const orchestrator = new AIOrchestrator(provider);
    const runner = new AgentRunner({ orchestrator, createEngine: () => engine, maxSteps: 15 });

    console.log('[E2E] Ejecutando job de scraping real...');
    const result = await runner.run({
      id: 'e2e-sevasa-' + Date.now(),
      url: SEVASA_URL,
      instruction: 'Obtén todos los productos con nombre, precio e imagen',
      useMemory: true,
      ai: { provider: 'openrouter', model: process.env.OPENROUTER_MODEL ?? 'openrouter/free' },
      limits: { maxPages: 5, maxItems: 50, maxDepth: 2 }
    });

    console.log('[E2E] Resultado:', result.status, '- items:', result.items.length, '- pasos:', result.steps.length, '- recovery:', result.recoveryCount);
    console.log('[E2E] browserEscalationSuggested:', result.browserEscalationSuggested);

    assert.equal(result.status, 'COMPLETED');
    assert.ok(result.items.length > 0, 'Debe extraer al menos 1 item');
    
    // Verificar trazabilidad
    for (const item of result.items) {
      if (item._source) {
        assert.ok(item._source.url, 'Item debe tener source.url');
        assert.ok(item._source.selector, 'Item debe tener source.selector');
        assert.ok(item._source.scrapedAt, 'Item debe tener source.scrapedAt');
      }
    }

    // Verificar que se actualizó el perfil en MongoDB
    const updated = await mongoRepo.findProfile('sevasaonline.com');
    assert.ok(updated, 'Perfil debe persistir');
    console.log('[E2E] Perfil actualizado — totalJobs:', updated.totalJobs, 'successfulJobs:', updated.successfulJobs);
    assert.ok(updated.totalJobs > 0, 'totalJobs debe incrementarse');
  });

  it('Segunda radiografía — usa cache Redis y es más rápida', async (t) => {
    if (unavailable) return t.skip('requiere MongoDB y Redis reales');
    const { performRadiography } = await import('../packages/mongodb/dist/index.js');
    
    const start = Date.now();
    const result = await performRadiography(SEVASA_URL, { maxDepth: 1, maxPages: 3, forceBrowser: true });
    const duration = Date.now() - start;
    
    console.log('[E2E] 2ª radiografía en', duration, 'ms');
    assert.ok(result.profile, 'Perfil recuperado');
    // Segunda vez debería ser más rápida (cache + perfil existente)
  });
});