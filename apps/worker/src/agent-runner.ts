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
import { AIOrchestrator, type AIProviderCallOpts } from '@ai-scraper/ai';
import { CommandValidator, normalizeRawCommand, clampCommandLimits } from '@ai-scraper/commands';
import { normalizeJobLimits } from '@ai-scraper/core';
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
  status: 'COMPLETED' | 'FAILED' | 'TIMEOUT' | 'CANCELLED';
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
  /**
   * Fábrica del engine (inyectar fetcher mock en tests). Recibe el hint del perfil
   * aprendido (FASE 12) para que el llamador decida si arma browser; la decisión de
   * capacidades vive en la factory, no mutando instancias.
   */
  createEngine?: (hint: { needsBrowser: boolean; allowedDomain: string; credentialOrigin: string; signal: AbortSignal }) => ExecutionEngine;
  maxSteps?: number;
  maxRecoveryAttempts?: number;
  /** Callback para abortar si el job fue cancelado (chequeo entre pasos). */
  isCancelled?: () => Promise<boolean>;
  /** Señal externa que puede acortar todavía más el deadline del runner. */
  signal?: AbortSignal;
}

const DATA_COMMANDS = new Set(['EXTRACT', 'EXTRACT_LIST', 'FOLLOW_LINKS', 'GET_ATTRIBUTE']);
const MAX_CONTEXT_LINKS = 40;
const MAX_CONTEXT_ELEMENTS = 40;

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

export class AgentRunner {
  private readonly maxSteps: number;
  private readonly maxRecoveryAttempts: number;

  constructor(private readonly deps: RunnerDeps) {
    this.maxSteps = deps.maxSteps ?? 25;
    this.maxRecoveryAttempts = deps.maxRecoveryAttempts ?? 2;
  }

  async run(job: AgentJob): Promise<AgentResult> {
    const limits = normalizeJobLimits(job.limits);
    const deadline = Date.now() + limits.maxRuntimeSec * 1000;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new DOMException(`maxRuntimeSec (${limits.maxRuntimeSec}s) alcanzado`, 'TimeoutError')),
      limits.maxRuntimeSec * 1000,
    );
    const onExternalAbort = () => controller.abort(this.deps.signal?.reason);
    if (this.deps.signal?.aborted) onExternalAbort();
    else this.deps.signal?.addEventListener('abort', onExternalAbort, { once: true });
    try {
      return await this.runInternal(job, limits, deadline, controller.signal);
    } finally {
      clearTimeout(timer);
      this.deps.signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  private async runInternal(
    job: AgentJob,
    limits: ReturnType<typeof normalizeJobLimits>,
    deadline: number,
    deadlineSignal: AbortSignal,
  ): Promise<AgentResult> {
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

    const validator = new CommandValidator({
      allowedDomain: domain,
      maxDepth: limits.maxDepth,
      maxPages: limits.maxPages,
    });
    // Deadline global del job (§35): acota el runtime total aunque maxSteps no se alcance.
    const pastDeadline = () => deadlineSignal.aborted || Date.now() > deadline;
    const checkCancel = this.deps.isCancelled ?? (async () => false);
    // Presupuesto de tokens IA por job (0/undefined = sin límite).
    const aiBudget = limits.maxAiTokens;
    let aiTokens = 0;
    const addTokens = () => { aiTokens += this.deps.orchestrator.lastCallTokens(); };
    const overBudget = () => aiTokens >= aiBudget;
    const aiCallOpts = (): AIProviderCallOpts => ({
      ...(job.ai?.model ? { model: job.ai.model } : {}),
      signal: deadlineSignal,
      maxTokens: Math.max(1, aiBudget - aiTokens),
      timeoutMs: Math.max(1, deadline - Date.now()),
    });

    // FASE 12: obtener perfil aprendido para decisiones inteligentes
    let learnedProfile = null;
    if (job.useMemory !== false) {
      debugLog('Obteniendo perfil aprendido...', { url: job.url });
      try {
        learnedProfile = await abortable(getLearnedProfile(job.url), deadlineSignal);
      } catch (error) {
        if (deadlineSignal.aborted) {
          return { ...base, status: 'TIMEOUT', error: `maxRuntimeSec (${limits.maxRuntimeSec}s) alcanzado al consultar memoria` };
        }
        throw error;
      }
      debugLog('Perfil aprendido', { 
        profile: learnedProfile?.profile ? { id: learnedProfile.profile.id, domain: learnedProfile.profile.domain } : null,
        shouldUseBrowser: learnedProfile?.shouldUseBrowser,
        recommendedSelectors: learnedProfile?.recommendedSelectors 
      });
    }

    // La decisión de capacidades (browser) vive en la factory: en producción
    // createProductionEngine ya expone browserInteract. Sin factory, el engine HTTP
    // plano devuelve needsBrowser en CLICK/SCROLL (§34); antes se mutaba la instancia
    // con Object.assign, frágil e incorrecto (borraba estado/deps).
    const engine = this.deps.createEngine
      ? this.deps.createEngine({
          needsBrowser: learnedProfile?.shouldUseBrowser ?? false,
          allowedDomain: domain,
          credentialOrigin: new URL(job.url).origin,
          signal: deadlineSignal,
        })
      : new ExecutionEngine({ allowedDomain: domain, credentialOrigin: new URL(job.url).origin, signal: deadlineSignal });
    let planActions: PlanAction[];
    const visited = () => [...engine.getMemory().visited];

    const steps: AgentStep[] = [];
    const items: unknown[] = [];
    let recoveryCount = 0;
    let browserEscalationSuggested = false;

    /**
     * Registra el resultado del job en el perfil del sitio (FASE 12). Si el dominio
     * aún no tiene perfil, lo crea; así cualquier job alimenta la memoria (antes
     * solo se registraba cuando ya existía un perfil de una radiografía previa).
     */
    let profileIdPromise: Promise<string | null> | null = null;
    const resolveProfileId = async (): Promise<string | null> => {
      if (learnedProfile?.profile?.id) return learnedProfile.profile.id;
      if (job.useMemory === false) return null;
      if (!profileIdPromise) {
        profileIdPromise = mongoRepo
          .getOrCreateProfile(domain, job.url)
          .then((p) => p.id ?? null)
          .catch(() => null);
      }
      return profileIdPromise;
    };

    /** Helper para registrar resultado en MongoDB (creando perfil si hace falta). */
    const recordResult = async (success: boolean, itemCount: number) => {
      if (deadlineSignal.aborted) return;
      const profileId = await resolveProfileId();
      if (!profileId) return;
      debugLog('Registrando resultado en MongoDB', { success, itemCount, profileId });
      await mongoRepo.recordJobResult(profileId, success, itemCount, 0).catch(() => undefined);
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
        const page = await abortable(engine.execute({ type: 'INSPECT_PAGE' } as never), deadlineSignal);
        const linksRes = await abortable(engine.execute({ type: 'INSPECT_LINKS' } as never), deadlineSignal);
        const elsRes = await abortable(engine.execute({ type: 'INSPECT_ELEMENTS' } as never), deadlineSignal);
        const data = (page.data as { title?: string }) ?? {};
        const links = ((linksRes.items as Array<{ text: string; href: string }>) ?? []).slice(0, MAX_CONTEXT_LINKS);
        const elements = ((elsRes.items as Array<{ type: string; selector: string; text: string }>) ?? []).slice(
          0,
          MAX_CONTEXT_ELEMENTS,
        );
        debugLog('OBSERVE RESULT', { url, title: data.title, linksCount: links.length, elementsCount: elements.length, depth });
        return { url, title: data.title ?? '', links, elements, depth };
      } catch (e) {
        if (deadlineSignal.aborted) throw e;
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
            aiCallOpts(),
          );
          addTokens();
          debugLog('RECOVERY LLM RESPONSE', { attempt, alternatives });
        } catch (e) {
          if (deadlineSignal.aborted) return null;
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
          const res = await abortable(engine.execute(valid as any), deadlineSignal);
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
      let res;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        res = await abortable(engine.execute(command as any), deadlineSignal);
      } catch (error) {
        if (deadlineSignal.aborted) {
          return { n, command, ok: false, error: `maxRuntimeSec (${limits.maxRuntimeSec}s) alcanzado` };
        }
        throw error;
      }
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
      const generated = await generatePlan(job, { orchestrator: this.deps.orchestrator, callOpts: aiCallOpts() });
      plan = generated.actions;
      planActions = generated.actions;
      base.providerName = generated.providerName;
      base.model = generated.model;
      addTokens();
      debugLog('PLAN GENERADO', { provider: generated.providerName, model: generated.model, actionsCount: plan.length, actions: plan.map(a => a.type) });
    } catch (e) {
      await recordResult(false, 0);
      debugError('PLAN GENERATION FAILED', e);
      if (deadlineSignal.aborted) {
        return { ...base, status: 'TIMEOUT', error: `maxRuntimeSec (${limits.maxRuntimeSec}s) alcanzado durante la planificación` };
      }
      return { ...base, status: 'FAILED', error: `No se pudo generar el plan: ${(e as Error).message}` };
    }

    for (const action of plan) {
      if (steps.length >= this.maxSteps) break;
      if (pastDeadline()) {
        await recordResult(items.length > 0, items.length);
        debugWarn('MAX RUNTIME REACHED (Fase A)', { maxRuntimeSec: limits.maxRuntimeSec, items: items.length });
        return {
          ...base, items, steps, recoveryCount, browserEscalationSuggested, planActions, visitedUrls: visited(),
          status: 'TIMEOUT',
          error: `maxRuntimeSec (${limits.maxRuntimeSec}s) alcanzado con ${items.length} items`,
        };
      }
      if (await checkCancel()) {
        await recordResult(items.length > 0, items.length);
        debugWarn('JOB CANCELLED (Fase A)', { items: items.length });
        return { ...base, items, steps, recoveryCount, browserEscalationSuggested, planActions, visitedUrls: visited(), status: 'CANCELLED', error: 'Job cancelado durante la ejecución' };
      }
      if (overBudget()) {
        await recordResult(items.length > 0, items.length);
        debugWarn('AI TOKEN BUDGET REACHED (Fase A)', { aiTokens, aiBudget, items: items.length });
        return {
          ...base, items, steps, recoveryCount, browserEscalationSuggested, planActions, visitedUrls: visited(),
          status: items.length > 0 ? 'COMPLETED' : 'FAILED',
          ...(items.length > 0
            ? { note: `Presupuesto IA (${aiBudget} tokens) alcanzado con ${items.length} items` }
            : { error: `Presupuesto IA (${aiBudget} tokens) alcanzado sin items` }),
        };
      }
      debugLog('EXECUTING PLAN ACTION', { action: action.type, step: steps.length + 1 });
      const step = await attemptStep(action as Record<string, unknown>);
      steps.push(step);
      if (deadlineSignal.aborted) {
        await recordResult(items.length > 0, items.length);
        return {
          ...base, items, steps, recoveryCount, browserEscalationSuggested, planActions, visitedUrls: visited(),
          status: 'TIMEOUT', error: `maxRuntimeSec (${limits.maxRuntimeSec}s) alcanzado durante ${String(action.type)}`,
        };
      }
      if (!step.ok) {
        // Si ya extrajimos items, un paso posterior que falla no debe tirar los resultados.
        const partial = items.length > 0;
        await recordResult(partial, items.length);
        if (partial) {
          debugWarn('PLAN STEP FAILED con items parciales', { step: step.n, items: items.length, error: step.error });
          return {
            ...base, items, steps, recoveryCount, browserEscalationSuggested, planActions, visitedUrls: visited(),
            status: 'COMPLETED', note: `Paso ${step.n} falló pero se extrajeron ${items.length} items: ${step.error}`,
          };
        }
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
          status: 'TIMEOUT',
          error: `maxRuntimeSec (${limits.maxRuntimeSec}s) alcanzado con ${items.length} items`,
        };
      }
      if (await checkCancel()) {
        await recordResult(items.length > 0, items.length);
        debugWarn('JOB CANCELLED (Fase B)', { items: items.length });
        return { ...base, items, steps, recoveryCount, browserEscalationSuggested, planActions, visitedUrls: visited(), status: 'CANCELLED', error: 'Job cancelado durante la ejecución' };
      }
      if (overBudget()) {
        await recordResult(items.length > 0, items.length);
        debugWarn('AI TOKEN BUDGET REACHED (Fase B)', { aiTokens, aiBudget, items: items.length });
        return {
          ...base, items, steps, recoveryCount, browserEscalationSuggested, planActions, visitedUrls: visited(),
          status: items.length > 0 ? 'COMPLETED' : 'FAILED',
          ...(items.length > 0
            ? { note: `Presupuesto IA (${aiBudget} tokens) alcanzado con ${items.length} items` }
            : { error: `Presupuesto IA (${aiBudget} tokens) alcanzado sin items` }),
        };
      }
      debugLog('PHASE B ITERATION', { currentStep: steps.length + 1, maxSteps: this.maxSteps });
      const ctx = await observe();
      let decisions: unknown[];
      try {
        decisions = await this.deps.orchestrator.analyzePage(
          { ...ctx, instruction: job.instruction, ...(job.ai?.model ? { model: job.ai.model } : {}) },
          aiCallOpts(),
        );
        addTokens();
        debugLog('ANALYZE PAGE DECISIONS', { decisionsCount: Array.isArray(decisions) ? decisions.length : 1, decisions });
      } catch (e) {
        await recordResult(items.length > 0, items.length);
        debugError('ANALYZE PAGE FAILED', e);
        if (deadlineSignal.aborted) {
          return {
            ...base, items, steps, recoveryCount, browserEscalationSuggested, planActions, visitedUrls: visited(),
            status: 'TIMEOUT', error: `maxRuntimeSec (${limits.maxRuntimeSec}s) alcanzado durante analyzePage`,
          };
        }
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
      if (deadlineSignal.aborted) {
        await recordResult(items.length > 0, items.length);
        return {
          ...base, items, steps, recoveryCount, browserEscalationSuggested, planActions, visitedUrls: visited(),
          status: 'TIMEOUT', error: `maxRuntimeSec (${limits.maxRuntimeSec}s) alcanzado durante ${String(decision.type)}`,
        };
      }
      if (!step.ok) {
        const partial = items.length > 0;
        await recordResult(partial, items.length);
        if (partial) {
          debugWarn('PHASE B STEP FAILED con items parciales', { step: step.n, items: items.length, error: step.error });
          return {
            ...base, items, steps, recoveryCount, browserEscalationSuggested, planActions, visitedUrls: visited(),
            status: 'COMPLETED', note: `Paso ${step.n} falló pero se extrajeron ${items.length} items: ${step.error}`,
          };
        }
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
