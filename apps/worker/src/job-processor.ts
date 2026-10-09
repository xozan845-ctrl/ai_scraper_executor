/**
 * Procesador de jobs — FASE 7.
 * Ejecuta un job (AgentRunner FASE 5+6) y persiste cada artefacto (§40):
 * estados, plan, comandos/pasos, páginas visitadas, resultados con
 * trazabilidad, errores e interacciones IA (stats para §56).
 */
import { AIOrchestrator } from '@ai-scraper/application-ai';
import { createAIProviderForJob, withCircuitBreaker } from '@ai-scraper/infrastructure-ai-providers';
import { ExecutionEngine } from '@ai-scraper/infrastructure-execution';
import { incMetric } from './metrics-bridge';
import { getJsonCache } from '@ai-scraper/infrastructure-redis';
import type { JobStore } from '@ai-scraper/infrastructure-storage';
import type { ScrapingJobPayload } from '@ai-scraper/infrastructure-queue';
import { AgentRunner, type AgentResult } from './agent-runner';
import { enrichItems } from './interpret';
import { createProductionEngine } from './browser-engine';
import { normalizeJobLimits } from '@ai-scraper/domain-execution';

export interface ProcessJobDeps {
  store: JobStore;
  /** Orquestador real por defecto; fake en tests. */
  createOrchestrator?: (payload: ScrapingJobPayload) => AIOrchestrator;
  createEngine?: (hint?: { signal: AbortSignal }) => ExecutionEngine;
  /** Credenciales de sesión (headers) por sessionId. */
  getCredentials?: (sessionId: string) => Promise<{ headers?: Record<string, string> } | null>;
  maxSteps?: number;
  maxRecoveryAttempts?: number;
}

function toSaveResult(item: unknown): { data: unknown; sourceUrl?: string; selector?: string; confidence?: number } {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    const src = (item as Record<string, unknown>)._source as
      | { url?: string; selector?: string; confidence?: number }
      | undefined;
    if (typeof src?.url !== 'string' || !src.url || typeof src.selector !== 'string' || !src.selector) {
      throw new Error('Resultado sin _source completo: se rechaza para preservar trazabilidad');
    }
    const scrapedAt = (src as { scrapedAt?: unknown }).scrapedAt;
    if (typeof scrapedAt !== 'string' || !scrapedAt) {
      throw new Error('Resultado sin _source.scrapedAt: se rechaza para preservar trazabilidad');
    }
    return {
      data: item,
      sourceUrl: src.url,
      selector: src.selector,
      confidence: typeof src?.confidence === 'number' ? src.confidence : undefined,
    };
  }
  throw new Error('Resultado no estructurado: se rechaza para preservar trazabilidad');
}

function hasCompleteSource(item: unknown): boolean {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  const source = (item as Record<string, unknown>)._source;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return false;
  const record = source as Record<string, unknown>;
  return typeof record.url === 'string' && Boolean(record.url)
    && typeof record.selector === 'string' && Boolean(record.selector)
    && typeof record.scrapedAt === 'string' && Boolean(record.scrapedAt);
}

export async function processJob(jobId: string, deps: ProcessJobDeps): Promise<AgentResult> {
  const { store } = deps;
  const record = await store.getJob(jobId);
  if (!record) throw new Error(`Job ${jobId} no encontrado en storage`);

  if (record.status === 'CANCELLED') {
    return {
      status: 'CANCELLED', items: [], steps: [], recoveryCount: 0,
      providerName: record.aiProvider ?? 'unknown', model: record.aiModel ?? 'default',
      browserEscalationSuggested: false, planActions: [], visitedUrls: [],
      error: 'Job cancelado antes de procesar',
    };
  }

  // Idempotencia ante reintentos BullMQ: limpia artefactos de intentos previos.
  await store.clearJobArtifacts(jobId);

  const payload: ScrapingJobPayload = {
    jobId: record.id,
    url: record.url,
    instruction: record.instruction,
    limits: (record.limits as Record<string, number>) ?? undefined,
    ai: { provider: record.aiProvider, model: record.aiModel },
  };
  const jobSignal = AbortSignal.timeout(normalizeJobLimits(payload.limits).maxRuntimeSec * 1000);

  const useCache = process.env.AI_CACHE !== '0';
  const cache = useCache ? await getJsonCache() : null;
  const orchestrator = deps.createOrchestrator
    ? deps.createOrchestrator(payload)
    : new AIOrchestrator(withCircuitBreaker(createAIProviderForJob(payload.ai) as never), cache);

  const isCancelled = async () => (await store.getJob(jobId))?.status === 'CANCELLED';
  // Credenciales de la sesión (headers) si el job viene de /sessions.
  const credentials = record.sessionId && deps.getCredentials
    ? await deps.getCredentials(record.sessionId).catch(() => null)
    : null;
  const createEngine = deps.createEngine
    ? (hint: { signal: AbortSignal }) => deps.createEngine!(hint)
    : (hint: { allowedDomain: string; credentialOrigin: string; signal: AbortSignal }) => createProductionEngine({
        ...(credentials?.headers ? { headers: credentials.headers } : {}),
        allowedDomain: hint.allowedDomain,
        credentialOrigin: hint.credentialOrigin,
        signal: hint.signal,
      });
  const runner = new AgentRunner({
    orchestrator,
    createEngine,
    maxSteps: deps.maxSteps,
    maxRecoveryAttempts: deps.maxRecoveryAttempts,
    isCancelled,
    signal: jobSignal,
  });

  await store.updateStatus(jobId, 'PLANNING');
  let result: AgentResult;
  try {
    await store.updateStatus(jobId, 'EXECUTING');
    result = await runner.run({
      id: record.id,
      url: record.url,
      instruction: record.instruction,
      limits: (record.limits as Record<string, number>) ?? undefined,
      ai: payload.ai,
    });
  } catch (e) {
    const message = (e as Error).message;
    await store.saveError(jobId, message);
    await store.updateStatus(jobId, 'FAILED');
    throw e;
  }

  // Si el job fue cancelado durante la ejecución, no sobrescribir el estado terminal.
  if (await isCancelled()) {
    await store.updateStatus(jobId, 'CANCELLED');
    return { ...result, status: 'CANCELLED', error: 'Job cancelado durante la ejecución' };
  }

  // Etapa 2: interpretar resultados (normalizar valores + confianza + dedup).
  let finalItems = enrichItems(result.items);
  if (process.env.AI_INTERPRET === '1' && finalItems.length > 0) {
    try {
      const interpreted = await orchestrator.interpret({
        instruction: record.instruction,
        rawItems: finalItems,
        ...(record.aiModel ? { model: record.aiModel } : {}),
      }, { signal: jobSignal, timeoutMs: Math.max(1, normalizeJobLimits(payload.limits).maxRuntimeSec * 1000) });
      if (Array.isArray(interpreted)) {
        const candidates = enrichItems(interpreted);
        if (candidates.every(hasCompleteSource)) finalItems = candidates;
      }
    } catch (e) {
      console.warn(`[WORKER] interpret falló: ${(e as Error).message}`);
    }
  }
  result.items = finalItems;

  // Persistir artefactos §40.
  await store.savePlan(jobId, { version: '1.0', actions: result.planActions });
  for (const step of result.steps) {
    await store.saveCommand(
      jobId,
      String((step.command as { type?: string }).type ?? 'UNKNOWN'),
      step.command,
      step.ok ? (step.recovered ? 'RECOVERED' : 'OK') : 'FAILED',
    );
  }
  for (const url of result.visitedUrls) {
    await store.savePage(jobId, url);
  }
  if (result.items.length > 0) {
    try {
      await store.saveResults(jobId, result.items.map(toSaveResult));
    } catch (error) {
      const message = (error as Error).message;
      await store.saveError(jobId, message);
      await store.updateStatus(jobId, 'FAILED');
      return { ...result, status: 'FAILED', error: message };
    }
  }
  const stats = orchestrator.lastStats();
  await store.saveAIInteraction(jobId, {
    provider: result.providerName,
    model: result.model,
    kind: 'run',
    request: { url: record.url, instruction: record.instruction },
    response: { status: result.status, steps: result.steps.length, items: result.items.length, cacheHits: orchestrator.cacheHitCount },
    tokens: stats?.tokens,
    latencyMs: stats?.latencyMs,
  });

  if (result.status === 'COMPLETED') {
    await store.updateStatus(jobId, 'COMPLETED');
    incMetric('jobs_completed_total');
    incMetric('items_extracted_total', result.items.length);
    incMetric('recoveries_total', result.recoveryCount);
  } else if (result.status === 'TIMEOUT') {
    await store.saveError(jobId, result.error ?? 'Tiempo máximo agotado', { steps: result.steps.length });
    await store.updateStatus(jobId, 'TIMEOUT');
    incMetric('jobs_timeout_total');
  } else if (result.status === 'CANCELLED') {
    await store.updateStatus(jobId, 'CANCELLED');
    incMetric('jobs_cancelled_total');
  } else {
    await store.saveError(jobId, result.error ?? 'Fallo desconocido', { steps: result.steps.length });
    await store.updateStatus(jobId, 'FAILED');
    incMetric('jobs_failed_total');
  }
  return result;
}
