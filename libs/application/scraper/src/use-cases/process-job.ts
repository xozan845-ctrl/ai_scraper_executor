/**
 * Procesador de jobs — FASE 7.
 * Ejecuta un job (AgentRunner FASE 5+6) y persiste cada artefacto (§40):
 * estados, plan, comandos/pasos, páginas visitadas, resultados con
 * trazabilidad, errores e interacciones IA (stats para §56).
 */
import { AIOrchestrator } from '@ai-scraper/application-ai';
import type { JobStore, ScrapingJobPayload } from '@ai-scraper/application-execution';
import { normalizeJobLimits } from '@ai-scraper/domain-execution';
import { metrics } from '@ai-scraper/shared-observability';
import { AgentRunner, type AgentResult } from './run-agent';
import { enrichItems } from '../services/interpret';
import type { CreateScraperEngine } from '../ports/scraper-engine';
import type { SiteMemory } from '../ports/site-memory';
import type { ScraperMetrics } from '../ports/scraper-metrics';
import type { WebhookEvent, WebhookNotifier } from '../ports/webhook-notifier';
import type { ProgressEvent, ProgressListener } from '../ports/progress';

export interface ProcessJobDeps {
  store: JobStore;
  /** Orquestador compuesto en el borde (proveedor real o fake en tests). */
  createOrchestrator: (payload: ScrapingJobPayload) => AIOrchestrator | Promise<AIOrchestrator>;
  /** Fábrica del motor compuesta en el borde (HTTP/browser o fake en tests). */
  createEngine: CreateScraperEngine;
  siteMemory?: SiteMemory;
  /** Política inyectada por el borde (`R-HX-13`). */
  allowPrivateHosts?: boolean;
  /** Log de diagnóstico inyectado por el borde. */
  debug?: boolean;
  metrics?: ScraperMetrics;
  webhookNotifier?: WebhookNotifier;
  onProgress?: ProgressListener;
  /** Credenciales de sesión (headers) por sessionId. */
  getCredentials?: (sessionId: string) => Promise<{ headers?: Record<string, string> } | null>;
  /** Activa la interpretación IA de resultados (configurada por el borde). */
  interpret?: boolean;
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
  const inc = (name: string, by = 1) => {
    if (deps.metrics) deps.metrics.inc(name, by);
    else metrics().inc(name, by);
  };
  const emit = (event: Omit<ProgressEvent, 'at' | 'jobId'>) => {
    try {
      deps.onProgress?.({ ...event, jobId, at: new Date().toISOString() });
    } catch {
      /* noop */
    }
  };
  const record = await store.getJob(jobId);
  if (!record) throw new Error(`Job ${jobId} no encontrado en storage`);

  const notifyWebhook = async (status: string, itemsCount: number, error?: string) => {
    if (!record.webhookUrl || !deps.webhookNotifier) return;
    try {
      await deps.webhookNotifier.notify(record.webhookUrl, {
        event: `job.${status.toLowerCase()}` as WebhookEvent['event'],
        jobId: record.id,
        status,
        url: record.url,
        itemsCount,
        ...(error ? { error } : {}),
        timestamp: new Date().toISOString(),
      });
      inc('webhooks_sent_total');
    } catch (notificationError) {
      inc('webhooks_failed_total');
      await store
        .saveError(record.id, `Webhook fallido: ${(notificationError as Error).message}`)
        .catch(() => undefined);
    }
  };

  if (record.status === 'CANCELLED') {
    const result: AgentResult = {
      status: 'CANCELLED', items: [], steps: [], recoveryCount: 0,
      providerName: record.aiProvider ?? 'unknown', model: record.aiModel ?? 'default',
      browserEscalationSuggested: false, planActions: [], visitedUrls: [],
      error: 'Job cancelado antes de procesar',
    };
    emit({ type: 'job.status', status: 'CANCELLED' });
    await notifyWebhook(result.status, 0, result.error);
    return result;
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

  const orchestrator = await deps.createOrchestrator(payload);

  const isCancelled = async () => (await store.getJob(jobId))?.status === 'CANCELLED';
  // Credenciales de la sesión (headers) si el job viene de /sessions.
  const credentials = record.sessionId && deps.getCredentials
    ? await deps.getCredentials(record.sessionId).catch(() => null)
    : null;
  const createEngine: CreateScraperEngine = (hint) => deps.createEngine({
    ...hint,
    ...(credentials?.headers ? { headers: credentials.headers } : {}),
  });
  const runner = new AgentRunner({
    orchestrator,
    createEngine,
    ...(deps.siteMemory ? { siteMemory: deps.siteMemory } : {}),
    ...(deps.allowPrivateHosts !== undefined ? { allowPrivateHosts: deps.allowPrivateHosts } : {}),
    ...(deps.debug !== undefined ? { debug: deps.debug } : {}),
    maxSteps: deps.maxSteps,
    maxRecoveryAttempts: deps.maxRecoveryAttempts,
    isCancelled,
    signal: jobSignal,
    ...(deps.onProgress ? { onProgress: deps.onProgress } : {}),
  });

  await store.updateStatus(jobId, 'PLANNING');
  emit({ type: 'job.status', status: 'PLANNING' });
  let result: AgentResult;
  try {
    await store.updateStatus(jobId, 'EXECUTING');
    emit({ type: 'job.status', status: 'EXECUTING' });
    result = await runner.run({
      id: record.id,
      url: record.url,
      instruction: record.instruction,
      limits: (record.limits as Record<string, number>) ?? undefined,
      ai: payload.ai,
      ...(record.render ? { render: record.render } : {}),
    });
  } catch (e) {
    const message = (e as Error).message;
    await store.saveError(jobId, message);
    await store.updateStatus(jobId, 'FAILED');
    emit({ type: 'job.status', status: 'FAILED', error: message });
    throw e;
  }

  // Si el job fue cancelado durante la ejecución, no sobrescribir el estado terminal.
  if (await isCancelled()) {
    await store.updateStatus(jobId, 'CANCELLED');
    return { ...result, status: 'CANCELLED', error: 'Job cancelado durante la ejecución' };
  }

  // Etapa 2: interpretar resultados (normalizar valores + validar + confianza + dedup).
  let finalItems = enrichItems(result.items, record.outputSchema);
  if (deps.interpret === true && finalItems.length > 0) {
    try {
      const interpreted = await orchestrator.interpret({
        instruction: record.instruction,
        rawItems: finalItems,
        ...(record.aiModel ? { model: record.aiModel } : {}),
      }, { signal: jobSignal, timeoutMs: Math.max(1, normalizeJobLimits(payload.limits).maxRuntimeSec * 1000) });
      if (Array.isArray(interpreted)) {
        const candidates = enrichItems(interpreted, record.outputSchema);
        if (candidates.every(hasCompleteSource)) finalItems = candidates;
      }
    } catch (e) {
      console.warn(`[WORKER] interpret falló: ${(e as Error).message}`);
    }
  }
  if (record.outputSchema?.strict) {
    const enrichedCount = finalItems.length;
    finalItems = finalItems.filter((item) => {
      const source = (item as { _source?: { validation?: { valid?: boolean } } })._source;
      return source?.validation?.valid !== false;
    });
    if (finalItems.length < enrichedCount) {
      await store
        .saveError(jobId, `${enrichedCount - finalItems.length} items descartados por outputSchema.strict`)
        .catch(() => undefined);
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
    emit({ type: 'job.status', status: 'COMPLETED', itemsCount: result.items.length });
    inc('jobs_completed_total');
    inc('items_extracted_total', result.items.length);
    inc('recoveries_total', result.recoveryCount);
  } else if (result.status === 'TIMEOUT') {
    await store.saveError(jobId, result.error ?? 'Tiempo máximo agotado', { steps: result.steps.length });
    await store.updateStatus(jobId, 'TIMEOUT');
    emit({ type: 'job.status', status: 'TIMEOUT', error: result.error });
    inc('jobs_timeout_total');
  } else if (result.status === 'CANCELLED') {
    await store.updateStatus(jobId, 'CANCELLED');
    emit({ type: 'job.status', status: 'CANCELLED' });
    inc('jobs_cancelled_total');
  } else {
    await store.saveError(jobId, result.error ?? 'Fallo desconocido', { steps: result.steps.length });
    await store.updateStatus(jobId, 'FAILED');
    emit({ type: 'job.status', status: 'FAILED', error: result.error });
    inc('jobs_failed_total');
  }
  await notifyWebhook(result.status, result.items.length, result.error);
  return result;
}
