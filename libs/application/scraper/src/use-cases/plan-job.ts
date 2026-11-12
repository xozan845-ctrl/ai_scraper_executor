/**
 * AI Planner — FASE 4 (§21.1) + FASE 12 (Memoria).
 * Convierte (url + instrucción en lenguaje natural) en un ScrapingPlan validado.
 *
 * - Instruction → AIOrchestrator.createPlan → validación estricta (CommandValidator §26).
 * - La IA NUNCA eleva límites (§35): PAGINATE/FOLLOW_LINKS/EXTRACT_LIST se recortan
 *   a los límites del job; el dominio queda fijado al de la URL inicial (§37).
 * - Selección de modelo por job §18: input.ai.model → opts/context → proveedor.
 * - FASE 12: inyecta perfil aprendido (selectores, paginación, needsBrowser) al contexto de la IA.
 */
import { AIOrchestrator } from '@ai-scraper/application-ai';
import { CommandValidator, normalizeRawPlan, clampCommandLimits } from '@ai-scraper/domain-ai';
import { normalizeJobLimits, type JobLimits } from '@ai-scraper/domain-execution';
import type { AIProviderCallOpts, PlanningContext } from '@ai-scraper/application-ai';
import type { LearnedSiteSnapshot, SiteMemory } from '../ports/site-memory';

export interface PlanJobInput {
  url: string;
  instruction: string;
  limits?: JobLimits;
  ai?: { provider?: string; model?: string };
  /** FASE 12: usar memoria aprendida (default true) */
  useMemory?: boolean;
}

export type PlanAction = Record<string, unknown>;

export interface GeneratedPlan {
  actions: PlanAction[];
  providerName: string;
  model: string;
  stats: { latencyMs: number; tokens?: number; model: string; provider: string } | null;
}

export interface PlannerDeps {
  orchestrator: AIOrchestrator;
  siteMemory?: SiteMemory;
  /** Política inyectada por el borde; el dominio no lee entorno (`R-HX-13`). */
  allowPrivateHosts?: boolean;
  /** Log de diagnóstico inyectado por el borde. */
  debug?: boolean;
  defaultModel?: string;
  callOpts?: AIProviderCallOpts;
}


export async function generatePlan(input: PlanJobInput, deps: PlannerDeps): Promise<GeneratedPlan> {
  const debug = deps.debug ?? false;
  const debugLog = (...args: unknown[]) => {
    if (debug) console.log('[PLANNER DEBUG]', new Date().toISOString(), ...args);
  };
  const debugError = (...args: unknown[]) => {
    if (debug) console.error('[PLANNER ERROR]', new Date().toISOString(), ...args);
  };
  debugLog('=== GENERATE PLAN START ===', { url: input.url, instruction: input.instruction, useMemory: input.useMemory !== false });
  let domain: string;
  try {
    domain = new URL(input.url).hostname;
  } catch {
    throw new Error(`URL inicial inválida: ${input.url}`);
  }

  const limits = normalizeJobLimits(input.limits);
  const validator = new CommandValidator({
    allowedDomain: domain,
    maxDepth: limits.maxDepth,
    maxPages: limits.maxPages,
    allowPrivateHosts: deps.allowPrivateHosts ?? false,
  });

  // FASE 12: obtener perfil aprendido
  let learnedProfile: LearnedSiteSnapshot | null = null;
  if (input.useMemory !== false && deps.siteMemory) {
    debugLog('Obteniendo perfil aprendido para planner...', { url: input.url });
    learnedProfile = await deps.siteMemory.getLearnedProfile(input.url);
    debugLog('Perfil aprendido para planner', { 
      profile: learnedProfile?.profile ? { id: learnedProfile.profile.id, domain: learnedProfile.profile.domain } : null,
      shouldUseBrowser: learnedProfile?.shouldUseBrowser,
      recommendedSelectors: learnedProfile?.recommendedSelectors 
    });
  }

  const orchestrator = deps.orchestrator;
  const model = input.ai?.model ?? deps.defaultModel;

  // Construir contexto enriquecido para la IA (tipado PlanningContext)
  const context: PlanningContext = {
    url: input.url,
    instruction: input.instruction,
    limits: limits as Record<string, number>,
    ...(model ? { model } : {}),
  };
  if (learnedProfile?.profile) {
    // Extender PlanningContext con learnedProfile (aceptado por proveedores que lo soporten)
    (context as unknown as Record<string, unknown>).learnedProfile = {
      domain: learnedProfile.profile.domain,
      isJavaScriptHeavy: learnedProfile.shouldUseBrowser,
      recommendedSelectors: learnedProfile.recommendedSelectors,
      stats: {
        totalJobs: learnedProfile.profile.totalJobs,
        successRate: learnedProfile.profile.totalJobs > 0
          ? learnedProfile.profile.successfulJobs / learnedProfile.profile.totalJobs
          : 0,
        avgItemsPerJob: learnedProfile.profile.avgItemsPerJob,
      },
    };
    debugLog('Contexto enriquecido con learnedProfile', { domain: learnedProfile.profile.domain, isJavaScriptHeavy: learnedProfile.shouldUseBrowser });
  }

  let raw: unknown;
  try {
    debugLog('LLAMANDO A ORCHESTRATOR.CREATEPLAN', { model, contextKeys: Object.keys(context) });
    raw = await orchestrator.createPlan(context, {
      ...deps.callOpts,
      ...(model ? { model } : {}),
    });
    debugLog('ORCHESTRATOR RAW RESPONSE', raw);
  } catch (e) {
    debugError('CREATEPLAN ERROR', e);
    throw new Error(`Planificación fallida (${orchestrator.providerName}): ${(e as Error).message}`, { cause: e });
  }

  // Normalizar el plan del LLM (tolerar "action"→"type", minúsculas, alias) ANTES de validar.
  const { actions: actionsRaw, notes: normNotes } = normalizeRawPlan(raw, input.url);
  if (normNotes.length) debugLog('NORMALIZACIÓN PLAN', { notes: normNotes });
  if (actionsRaw.length === 0) {
    throw new Error(
      `Planificación inválida (${orchestrator.providerName}): no se pudo normalizar ninguna acción`,
    );
  }

  // Validación estricta (all-or-nothing): las acciones ya vienen normalizadas
  // (formato corregido), pero un comando que viola dominio/SSRF/límites hace fallar
  // el plan (§26/§37). Los comandos inventados ya fueron filtrados en la normalización.
  debugLog('VALIDANDO Y RECORTANDO ACCIONES', { rawActionsCount: actionsRaw.length, limits });
  const actions: PlanAction[] = [];
  for (const a of actionsRaw) {
    clampCommandLimits(a as Record<string, unknown>, { maxPages: limits.maxPages, maxItems: limits.maxItems });
    const valid = validator.validateCommand(a) as unknown as PlanAction;
    actions.push(valid);
  }

  debugLog('PLAN FINAL', { actionsCount: actions.length, actions: actions.map(a => a.type) });

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
