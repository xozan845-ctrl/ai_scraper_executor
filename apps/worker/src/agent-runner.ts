/**
 * AgentRunner — FASE 5 (bucle Observe→Think→Act §47) + FASE 6 (Recovery §28) + FASE 12 (Memoria).
 *
 * - Fase A: genera el plan (FASE 4) y lo ejecuta acción por acción.
 * - Fase B: bucle dinámico — observa la página (INSPECT_* vía engine),
 *   pide la siguiente decisión al LLM (analyzePage), valida (§26) y ejecuta (§27).
 * - Cada fallo (validación, ejecución, 0 elementos) entra en Recovery: se pide
 *   una alternativa al LLM (recover) hasta maxRecoveryAttempts. El contenido de
 *   la página viaja como datos (§37), nunca como instrucciones privilegiadas.
 * - Límites del job (§35) y dominio (§37) se aplican en cada paso; el loop está
 *   acotado por maxSteps y corta al alcanzar maxItems.
 * - FASE 12: consulta perfil aprendido (MongoDB) para selectores y needsBrowser;
 *   registra resultado del job para mejorar perfiles futuros.
 */
import { AIOrchestrator } from '@ai-scraper/ai';
import { CommandValidator, normalizeRawCommand, clampCommandLimits } from '@ai-scraper/commands';
import { DEFAULT_LIMITS } from '@ai-scraper/core';
import { ExecutionEngine } from '@ai-scraper/execution-engine';
import { generatePlan, type PlanJobInput, type PlanAction } from './planner';
import { getLearnedProfile, mongoRepo } from '@ai-scraper/mongodb';

// Debug flag - activar con DEBUG=1 o LOG_LEVEL=debug
const DEBUG = process.env.DEBUG === '1' || process.env.LOG_LEVEL === 'debug';

function debugLog(...args: unknown[]) {
  if (DEBUG) console.log('[AGENT-RUNNER DEBUG]', new Date().toISOString(), ...args);
}

function debugError(...args: unknown[]) {
  if (DEBUG) console.error('[AGENT-RUNNER ERROR]', new Date().toISOString(), ...args);
}

function debugWarn(...args: unknown[]) {
  if (DEBUG) console.warn('[AGENT-RUNNER WARN]', new Date().toISOString(), ...args);
}

export interface AgentJob extends PlanJobInput {
  id: string;
}

export interface AgentStep {
  n: number;
  command: Record<string, unknown>;
  ok: boolean;
  count?: number;
  error?: string;
  recovered?: boolean;
  needsBrowser?: boolean;
  /** true cuando el paso se resolvió en Chromium real (ETAPA 3). */
  usedBrowser?: boolean;
}

export interface AgentResult {
  status: 'COMPLETED' | 'FAILED';
  items: unknown[];
  steps: AgentStep[];
  recoveryCount: number;
  providerName: string;
  model: string;
  browserEscalationSuggested: boolean;
  /** Plan generado (FASE 4) para persistencia §40. Vacío si falló la planificación. */
  planActions: PlanAction[];
  /** URLs visitadas por el engine para persistencia de Page §40. */
  visitedUrls: string[];
  note?: string;
  error?: string;
}

export interface RunnerDeps {
  orchestrator: AIOrchestrator;
  /** Fábrica del engine (inyectar fetcher mock en tests). */
  createEngine?: () => ExecutionEngine;
  maxSteps?: number;
  maxRecoveryAttempts?: number;
}

const DATA_COMMANDS = new Set(['EXTRACT', 'EXTRACT_LIST', 'FOLLOW_LINKS', 'GET_ATTRIBUTE']);
const MAX_CONTEXT_LINKS = 40;
const MAX_CONTEXT_ELEMENTS = 40;

export class AgentRunner {
  private readonly maxSteps: number;
  private readonly maxRecoveryAttempts: number;

  constructor(private readonly deps: RunnerDeps) {
    this.maxSteps = deps.maxSteps ?? 25;
    this.maxRecoveryAttempts = deps.maxRecoveryAttempts ?? 2;
  }

  async run(job: AgentJob): Promise<AgentResult> {
    debugLog('=== INICIO AGENT RUNNER ===', { jobId: job.id, url: job.url, instruction: job.instruction, useMemory: job.useMemory !== false });
    const base: Omit<AgentResult, 'status'> = {
      items: [],
      steps: [],
      recoveryCount: 0,
      providerName: this.deps.orchestrator.providerName,
      model: job.ai?.model ?? 'default',
      browserEscalationSuggested: false,
      planActions: [],
      visitedUrls: [],
    };
    let domain: string;
    try {
      domain = new URL(job.url).hostname;
    } catch {
      return { ...base, status: 'FAILED', error: `URL inicial inválida: ${job.url}` };
    }

    const limits = { ...DEFAULT_LIMITS, ...job.limits };
    const validator = new CommandValidator({
      allowedDomain: domain,
      maxDepth: limits.maxDepth,
      maxPages: limits.maxPages,
    });
    // Deadline global del job (§35): acota el runtime total aunque maxSteps no se alcance.
    const deadline = Date.now() + limits.maxRuntimeSec * 1000;
    const pastDeadline = () => Date.now() > deadline;

    // FASE 12: obtener perfil aprendido para decisiones inteligentes
    let learnedProfile = null;
    if (job.useMemory !== false) {
      debugLog('Obteniendo perfil aprendido...', { url: job.url });
      learnedProfile = await getLearnedProfile(job.url);
      debugLog('Perfil aprendido', { 
        profile: learnedProfile?.profile ? { id: learnedProfile.profile.id, domain: learnedProfile.profile.domain } : null,
        shouldUseBrowser: learnedProfile?.shouldUseBrowser,
        recommendedSelectors: learnedProfile?.recommendedSelectors 
      });
    }

    const engine = this.deps.createEngine ? this.deps.createEngine() : new ExecutionEngine();
    // Si el perfil dice que necesita browser, forzamos la creación con browser
    if (learnedProfile?.shouldUseBrowser && !this.deps.createEngine) {
      debugLog('Perfil indica needsBrowser=true, creando engine con browser...');
      const { createProductionEngine } = await import('./browser-engine');
      Object.assign(engine, createProductionEngine());
    }
    const modelOpts = job.ai?.model ? { model: job.ai.model } : undefined;
    let planActions: PlanAction[];
    const visited = () => [...engine.getMemory().visited];

    const steps: AgentStep[] = [];
    const items: unknown[] = [];
    let recoveryCount = 0;
    let browserEscalationSuggested = false;

    /** Helper para registrar resultado en MongoDB si hay perfil */
    const recordResult = async (success: boolean, itemCount: number) => {
      if (learnedProfile?.profile) {
        debugLog('Registrando resultado en MongoDB', { success, itemCount });
        await mongoRepo.recordJobResult(learnedProfile.profile.id!, success, itemCount, 0);
      }
    };

    const observe = async (): Promise<{
      url: string;
      title: string;
      links: Array<{ text: string; href: string }>;
      elements: Array<{ type: string; selector: string; text: string }>;
      depth: number;
    }> => {
      const url = engine.getCurrentUrl() ?? job.url;
      const depth = engine.getMemory().visited.length;
      debugLog('OBSERVE', { url, depth });
      try {
        const page = await engine.execute({ type: 'INSPECT_PAGE' } as never);
        const linksRes = await engine.execute({ type: 'INSPECT_LINKS' } as never);
        const elsRes = await engine.execute({ type: 'INSPECT_ELEMENTS' } as never);
        const data = (page.data as { title?: string }) ?? {};
        const links = ((linksRes.items as Array<{ text: string; href: string }>) ?? []).slice(0, MAX_CONTEXT_LINKS);
        const elements = ((elsRes.items as Array<{ type: string; selector: string; text: string }>) ?? []).slice(
          0,
          MAX_CONTEXT_ELEMENTS,
        );
        debugLog('OBSERVE RESULT', { url, title: data.title, linksCount: links.length, elementsCount: elements.length, depth });
        return { url, title: data.title ?? '', links, elements, depth };
      } catch (e) {
        debugError('OBSERVE ERROR', e);
        return { url, title: '', links: [], elements: [], depth };
      }
    };

    const recoverAndExecute = async (
      failedCommand: Record<string, unknown>,
      error: string,
    ): Promise<{ ok: boolean; command: Record<string, unknown>; count?: number; error?: string; needsBrowser?: boolean; usedBrowser?: boolean; resItems?: unknown[] } | null> => {
      debugLog('RECOVERY START', { failedCommand, error });
      for (let attempt = 1; attempt <= this.maxRecoveryAttempts; attempt += 1) {
        debugLog('RECOVERY ATTEMPT', { attempt, maxAttempts: this.maxRecoveryAttempts });
        const ctx = await observe();
        let alternatives: unknown[];
        try {
          alternatives = await this.deps.orchestrator.recover(
            { ...ctx, instruction: job.instruction, failedCommand, error, ...(job.ai?.model ? { model: job.ai.model } : {}) },
            modelOpts,
          );
          debugLog('RECOVERY LLM RESPONSE', { attempt, alternatives });
        } catch (e) {
          error = `recovery LLM falló (intento ${attempt}): ${(e as Error).message}`;
          debugError('RECOVERY LLM ERROR', { attempt, error });
          continue;
        }
        const candidate = (Array.isArray(alternatives) ? alternatives[0] : alternatives) as Record<string, unknown>;
        if (!candidate || typeof candidate !== 'object') {
          error = `recovery devolvió decisión vacía (intento ${attempt})`;
          debugWarn('RECOVERY EMPTY DECISION', { attempt });
          continue;
        }
        try {
          const { command: normalizedRec } = normalizeRawCommand(candidate);
          if (!normalizedRec) throw new Error('comando de recovery no reconocible');
          // §35: la IA no puede elevar límites tampoco en recovery.
          clampCommandLimits(normalizedRec, { maxPages: limits.maxPages, maxItems: limits.maxItems });
          const valid = validator.validateCommand(normalizedRec) as unknown as PlanAction;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const res = await engine.execute(valid as any);
          if (res.ok) {
            recoveryCount += 1;
            if (res.needsBrowser || res.usedBrowser) browserEscalationSuggested = true;
            return { ok: true, command: valid as Record<string, unknown>, count: res.count, needsBrowser: res.needsBrowser, usedBrowser: res.usedBrowser, resItems: res.items };
          }
          error = res.error ?? `comando alternativo falló (intento ${attempt})`;
        } catch (e) {
          error = (e as Error).message;
        }
      }
      return null;
    };

    const attemptStep = async (raw: Record<string, unknown>): Promise<AgentStep & { resItems?: unknown[] }> => {
      const n = steps.length + 1;
      debugLog('ATTEMPT STEP', { step: n, rawCommand: raw });
      let command: Record<string, unknown>;
      try {
        // Normalizar tolerando "action"→"type", minúsculas y alias.
        const { command: normalized, notes } = normalizeRawCommand(raw);
        if (!normalized) throw new Error(`comando no reconocible`);
        if (notes.length) debugLog('COMANDO NORMALIZADO', { step: n, notes });
        // §35: recorta límites también en las decisiones dinámicas (Fase B).
        clampCommandLimits(normalized, { maxPages: limits.maxPages, maxItems: limits.maxItems });
        command = validator.validateCommand(normalized) as unknown as Record<string, unknown>;
        debugLog('VALIDATION OK', { step: n, command: command.type });
      } catch (e) {
        const err = `validación rechazada: ${(e as Error).message}`;
        debugWarn('VALIDATION FAILED', { step: n, error: err });
        const rec = await recoverAndExecute(raw, err);
        if (rec) {
          if (rec.needsBrowser || rec.usedBrowser) browserEscalationSuggested = true;
          const step: AgentStep = { n, command: rec.command, ok: true, count: rec.count, recovered: true, needsBrowser: rec.needsBrowser, usedBrowser: rec.usedBrowser };
          return { ...step, resItems: rec.resItems };
        }
        return { n, command: raw, ok: false, error: `${err} (recovery agotado)` };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await engine.execute(command as any);
      debugLog('ENGINE EXEC RESULT', { step: n, command: command.type, ok: res.ok, count: res.count, error: res.error, needsBrowser: res.needsBrowser, usedBrowser: res.usedBrowser });
      if (res.needsBrowser || res.usedBrowser) browserEscalationSuggested = true;
      if (res.ok) {
        debugLog('STEP SUCCESS', { step: n, command: command.type, count: res.count });
        return { n, command, ok: true, count: res.count, needsBrowser: res.needsBrowser, usedBrowser: res.usedBrowser, resItems: res.items };
      }
      debugWarn('STEP FAILED, starting recovery', { step: n, error: res.error });
      const rec = await recoverAndExecute(command, res.error ?? 'ejecución fallida');
      if (rec) {
        if (rec.needsBrowser || rec.usedBrowser) browserEscalationSuggested = true;
        return { n, command: rec.command, ok: true, count: rec.count, recovered: true, needsBrowser: rec.needsBrowser, usedBrowser: rec.usedBrowser, resItems: rec.resItems };
      }
      return { n, command, ok: false, error: `${res.error ?? 'ejecución fallida'} (recovery agotado)`, needsBrowser: res.needsBrowser, usedBrowser: res.usedBrowser };
    };

    const pushItems = (resItems: unknown[] | undefined, commandType: string) => {
      if (!resItems || !DATA_COMMANDS.has(commandType)) return;
      for (const it of resItems) {
        if (items.length >= limits.maxItems) break;
        items.push(it);
      }
    };

    // ---- Fase A: plan ----
    debugLog('=== FASE A: PLANIFICACIÓN ===');
    let plan: PlanAction[];
    try {
      const generated = await generatePlan(job, { orchestrator: this.deps.orchestrator });
      plan = generated.actions;
      planActions = generated.actions;
      base.providerName = generated.providerName;
      base.model = generated.model;
      debugLog('PLAN GENERADO', { provider: generated.providerName, model: generated.model, actionsCount: plan.length, actions: plan.map(a => a.type) });
    } catch (e) {
      await recordResult(false, 0);
      debugError('PLAN GENERATION FAILED', e);
      return { ...base, status: 'FAILED', error: `No se pudo generar el plan: ${(e as Error).message}` };
    }

    for (const action of plan) {
      if (steps.length >= this.maxSteps) break;
      if (pastDeadline()) {
        await recordResult(items.length > 0, items.length);
        debugWarn('MAX RUNTIME REACHED (Fase A)', { maxRuntimeSec: limits.maxRuntimeSec, items: items.length });
        return {
          ...base, items, steps, recoveryCount, browserEscalationSuggested, planActions, visitedUrls: visited(),
          status: items.length > 0 ? 'COMPLETED' : 'FAILED',
          ...(items.length > 0
            ? { note: `maxRuntimeSec (${limits.maxRuntimeSec}s) alcanzado con ${items.length} items` }
            : { error: `maxRuntimeSec (${limits.maxRuntimeSec}s) alcanzado sin items` }),
        };
      }
      debugLog('EXECUTING PLAN ACTION', { action: action.type, step: steps.length + 1 });
      const step = await attemptStep(action as Record<string, unknown>);
      steps.push(step);
      if (!step.ok) {
        await recordResult(false, items.length);
        debugError('PLAN STEP FAILED', { step: step.n, error: step.error });
        return {
          ...base, items, steps, recoveryCount, browserEscalationSuggested, planActions, visitedUrls: visited(),
          status: 'FAILED', error: `Paso ${step.n} (${String((step.command as { type?: string }).type)}) falló: ${step.error}`,
        };
      }
      pushItems((step as { resItems?: unknown[] }).resItems, String((step.command as { type?: string }).type));
      if (String((step.command as { type?: string }).type) === 'FINISH') {
        await recordResult(true, items.length);
        debugLog('FINISH REACHED', { totalItems: items.length, totalSteps: steps.length });
        return { ...base, items, steps, recoveryCount, browserEscalationSuggested, planActions, visitedUrls: visited(), status: 'COMPLETED' };
      }
      if (items.length >= limits.maxItems) {
        await recordResult(true, items.length);
        debugLog('MAX ITEMS REACHED', { itemsCount: items.length, limit: limits.maxItems });
        return {
          ...base, items, steps, recoveryCount, browserEscalationSuggested, planActions, visitedUrls: visited(),
          status: 'COMPLETED', note: `Límite maxItems (${limits.maxItems}) alcanzado`,
        };
      }
    }

    // ---- Fase B: bucle dinámico §47 ----
    debugLog('=== FASE B: BUCLE DINÁMICO (Observe→Think→Act) ===');
    while (steps.length < this.maxSteps) {
      if (pastDeadline()) {
        await recordResult(items.length > 0, items.length);
        debugWarn('MAX RUNTIME REACHED (Fase B)', { maxRuntimeSec: limits.maxRuntimeSec, items: items.length });
        return {
          ...base, items, steps, recoveryCount, browserEscalationSuggested, planActions, visitedUrls: visited(),
          status: items.length > 0 ? 'COMPLETED' : 'FAILED',
          ...(items.length > 0
            ? { note: `maxRuntimeSec (${limits.maxRuntimeSec}s) alcanzado con ${items.length} items` }
            : { error: `maxRuntimeSec (${limits.maxRuntimeSec}s) alcanzado sin items` }),
        };
      }
      debugLog('PHASE B ITERATION', { currentStep: steps.length + 1, maxSteps: this.maxSteps });
      const ctx = await observe();
      let decisions: unknown[];
      try {
        decisions = await this.deps.orchestrator.analyzePage(
          { ...ctx, instruction: job.instruction, ...(job.ai?.model ? { model: job.ai.model } : {}) },
          modelOpts,
        );
        debugLog('ANALYZE PAGE DECISIONS', { decisionsCount: Array.isArray(decisions) ? decisions.length : 1, decisions });
      } catch (e) {
        await recordResult(items.length > 0, items.length);
        debugError('ANALYZE PAGE FAILED', e);
        return {
          ...base, items, steps, recoveryCount, browserEscalationSuggested, planActions, visitedUrls: visited(),
          status: items.length > 0 ? 'COMPLETED' : 'FAILED',
          ...(items.length > 0
            ? { note: `analyzePage falló pero hay ${items.length} items: ${(e as Error).message}` }
            : { error: `analyzePage falló: ${(e as Error).message}` }),
        };
      }
      const decision = (Array.isArray(decisions) ? decisions[0] : decisions) as Record<string, unknown>;
      debugLog('DECISION RECEIVED', { decision: decision.type });
      if (!decision || typeof decision !== 'object') {
        await recordResult(items.length > 0, items.length);
        debugWarn('EMPTY DECISION FROM LLM');
        return {
          ...base, items, steps, recoveryCount, browserEscalationSuggested, planActions, visitedUrls: visited(),
          status: items.length > 0 ? 'COMPLETED' : 'FAILED',
          ...(items.length > 0
            ? { note: 'Decisión vacía del LLM con items parciales' }
            : { error: 'El LLM devolvió una decisión vacía' }),
        };
      }
      const step = await attemptStep(decision);
      steps.push(step);
      if (!step.ok) {
        await recordResult(false, items.length);
        debugError('PHASE B STEP FAILED', { step: step.n, error: step.error });
        return {
          ...base, items, steps, recoveryCount, browserEscalationSuggested, planActions, visitedUrls: visited(),
          status: 'FAILED', error: `Paso ${step.n} falló: ${step.error}`,
        };
      }
      pushItems((step as { resItems?: unknown[] }).resItems, String((step.command as { type?: string }).type));
      if (String((step.command as { type?: string }).type) === 'FINISH') {
        await recordResult(true, items.length);
        debugLog('FINISH REACHED IN PHASE B', { totalItems: items.length, totalSteps: steps.length });
        return { ...base, items, steps, recoveryCount, browserEscalationSuggested, planActions, visitedUrls: visited(), status: 'COMPLETED' };
      }
      if (items.length >= limits.maxItems) {
        await recordResult(true, items.length);
        debugLog('MAX ITEMS REACHED IN PHASE B', { itemsCount: items.length, limit: limits.maxItems });
        return {
          ...base, items, steps, recoveryCount, browserEscalationSuggested, planActions, visitedUrls: visited(),
          status: 'COMPLETED', note: `Límite maxItems (${limits.maxItems}) alcanzado`,
        };
      }
    }

    if (items.length > 0) {
      await recordResult(true, items.length);
      return {
        ...base, items, steps, recoveryCount, browserEscalationSuggested,
        status: 'COMPLETED', note: `maxSteps (${this.maxSteps}) alcanzado con ${items.length} items parciales`,
      };
    }
    await recordResult(false, 0);
    return {
      ...base, items, steps, recoveryCount, browserEscalationSuggested,
      status: 'FAILED', error: `maxSteps (${this.maxSteps}) alcanzado sin FINISH ni items`,
    };
  }
}