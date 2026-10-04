/**
 * AI Planner — FASE 4 (§21.1).
 * Convierte (url + instrucción en lenguaje natural) en un ScrapingPlan validado.
 *
 * - Instruction → AIOrchestrator.createPlan → validación estricta (CommandValidator §26).
 * - La IA NUNCA eleva límites (§35): PAGINATE/FOLLOW_LINKS/EXTRACT_LIST se recortan
 *   a los límites del job; el dominio queda fijado al de la URL inicial (§37).
 * - Selección de modelo por job §18: input.ai.model → opts/context → proveedor.
 */
import { AIOrchestrator } from '@ai-scraper/ai';
import { CommandValidator } from '@ai-scraper/commands';
import { DEFAULT_LIMITS } from '@ai-scraper/core';
import { createAIProviderForJob } from '@ai-scraper/ai-providers';

export interface PlanLimits {
  maxPages?: number;
  maxDepth?: number;
  maxItems?: number;
  maxRuntimeSec?: number;
  maxRequests?: number;
}

export interface PlanJobInput {
  url: string;
  instruction: string;
  limits?: PlanLimits;
  ai?: { provider?: string; model?: string };
}

export type PlanAction = Record<string, unknown>;

export interface GeneratedPlan {
  actions: PlanAction[];
  providerName: string;
  model: string;
  /** Stats de la llamada de planificación (latencia/tokens) si el proveedor las expone. */
  stats: { latencyMs: number; tokens?: number; model: string; provider: string } | null;
}

export interface PlannerDeps {
  orchestrator?: AIOrchestrator;
  defaultModel?: string;
}

function mergeLimits(input?: PlanLimits): Required<PlanLimits> {
  return { ...DEFAULT_LIMITS, ...input };
}

function clampInt(value: unknown, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(Math.max(n, 1), max);
}

export async function generatePlan(input: PlanJobInput, deps?: PlannerDeps): Promise<GeneratedPlan> {
  let domain: string;
  try {
    domain = new URL(input.url).hostname;
  } catch {
    throw new Error(`URL inicial inválida: ${input.url}`);
  }

  const limits = mergeLimits(input.limits);
  const validator = new CommandValidator({
    allowedDomain: domain,
    maxDepth: limits.maxDepth,
    maxPages: limits.maxPages,
  });

  const orchestrator =
    deps?.orchestrator ?? new AIOrchestrator(createAIProviderForJob(input.ai) as never);
  const model = input.ai?.model ?? deps?.defaultModel;

  let raw: unknown;
  try {
    raw = await orchestrator.createPlan(
      { url: input.url, instruction: input.instruction, limits, ...(model ? { model } : {}) },
      model ? { model } : undefined,
    );
  } catch (e) {
    throw new Error(`Planificación fallida (${orchestrator.providerName}): ${(e as Error).message}`, { cause: e });
  }

  // Tolerar que el modelo devuelva el array de acciones directamente.
  const actionsRaw: unknown =
    Array.isArray(raw) ? raw : (raw as { actions?: unknown })?.actions;
  if (!Array.isArray(actionsRaw) || actionsRaw.length === 0) {
    throw new Error(
      `Planificación inválida (${orchestrator.providerName}): se esperaba {actions:[...]} con al menos 1 acción`,
    );
  }

  // Validación estricta + recorte a límites del job (la IA no puede elevarlos §35).
  const actions = (actionsRaw as unknown[]).map((a) => {
    const valid = validator.validateCommand(a) as unknown as PlanAction;
    const type = valid.type as string;
    if (type === 'PAGINATE') {
      (valid as Record<string, unknown>).maxPages = clampInt(valid.maxPages, limits.maxPages, limits.maxPages);
    }
    if (type === 'FOLLOW_LINKS') {
      (valid as Record<string, unknown>).maxLinks = clampInt(valid.maxLinks, limits.maxPages, 10);
    }
    if (type === 'EXTRACT_LIST') {
      (valid as Record<string, unknown>).limit = clampInt(valid.limit, limits.maxItems, 100);
    }
    return valid;
  });

  // Todo plan debe empezar navegando a la URL del job.
  if (actions[0]?.type !== 'NAVIGATE') {
    actions.unshift({ type: 'NAVIGATE', url: input.url });
  }

  const stats = orchestrator.lastStats();
  return {
    actions,
    providerName: orchestrator.providerName,
    model: stats?.model ?? model ?? 'default',
    stats,
  };
}
