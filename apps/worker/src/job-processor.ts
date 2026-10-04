/**
 * Procesador de jobs — FASE 7.
 * Ejecuta un job (AgentRunner FASE 5+6) y persiste cada artefacto (§40):
 * estados, plan, comandos/pasos, páginas visitadas, resultados con
 * trazabilidad, errores e interacciones IA (stats para §56).
 */
import { AIOrchestrator } from '@ai-scraper/ai';
import { createAIProviderForJob } from '@ai-scraper/ai-providers';
import { ExecutionEngine } from '@ai-scraper/execution-engine';
import { metrics } from '@ai-scraper/observability';
import type { JobStore } from '@ai-scraper/storage';
import type { ScrapingJobPayload } from '@ai-scraper/queue';
import { AgentRunner, type AgentResult } from './agent-runner';

export interface ProcessJobDeps {
  store: JobStore;
  /** Orquestador real por defecto; fake en tests. */
  createOrchestrator?: (payload: ScrapingJobPayload) => AIOrchestrator;
  createEngine?: () => ExecutionEngine;
  maxSteps?: number;
  maxRecoveryAttempts?: number;
}

function toSaveResult(item: unknown): { data: unknown; sourceUrl?: string; selector?: string; confidence?: number } {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    const src = (item as Record<string, unknown>)._source as
      | { url?: string; selector?: string }
      | undefined;
    const { _source: _dropped, ...data } = item as Record<string, unknown>;
    return {
      data,
      sourceUrl: typeof src?.url === 'string' ? src.url : undefined,
      selector: typeof src?.selector === 'string' ? src.selector : undefined,
    };
  }
  return { data: item };
}

export async function processJob(jobId: string, deps: ProcessJobDeps): Promise<AgentResult> {
  const { store } = deps;
  const record = await store.getJob(jobId);
  if (!record) throw new Error(`Job ${jobId} no encontrado en storage`);

  if (record.status === 'CANCELLED') {
    return {
      status: 'FAILED', items: [], steps: [], recoveryCount: 0,
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

  const orchestrator = deps.createOrchestrator
    ? deps.createOrchestrator(payload)
    : new AIOrchestrator(createAIProviderForJob(payload.ai) as never);

  const isCancelled = async () => (await store.getJob(jobId))?.status === 'CANCELLED';
  const runner = new AgentRunner({
    orchestrator,
    createEngine: deps.createEngine,
    maxSteps: deps.maxSteps,
    maxRecoveryAttempts: deps.maxRecoveryAttempts,
    isCancelled,
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
    return { ...result, status: 'FAILED', error: 'Job cancelado durante la ejecución' };
  }

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
    await store.saveResults(jobId, result.items.map(toSaveResult));
  }
  const stats = orchestrator.lastStats();
  await store.saveAIInteraction(jobId, {
    provider: result.providerName,
    model: result.model,
    kind: 'run',
    request: { url: record.url, instruction: record.instruction },
    response: { status: result.status, steps: result.steps.length, items: result.items.length },
    tokens: stats?.tokens,
    latencyMs: stats?.latencyMs,
  });

  if (result.status === 'COMPLETED') {
    await store.updateStatus(jobId, 'COMPLETED');
    metrics().inc('jobs_completed_total');
    metrics().inc('items_extracted_total', result.items.length);
    metrics().inc('recoveries_total', result.recoveryCount);
  } else {
    await store.saveError(jobId, result.error ?? 'Fallo desconocido', { steps: result.steps.length });
    await store.updateStatus(jobId, 'FAILED');
    metrics().inc('jobs_failed_total');
  }
  return result;
}
