/**
 * AgentRunner — FASE 5 (bucle Observe→Think→Act §47) + FASE 6 (Recovery §28).
 *
 * - Fase A: genera el plan (FASE 4) y lo ejecuta acción por acción.
 * - Fase B: bucle dinámico — observa la página (INSPECT_* vía engine),
 *   pide la siguiente decisión al LLM (analyzePage), valida (§26) y ejecuta (§27).
 * - Cada fallo (validación, ejecución, 0 elementos) entra en Recovery: se pide
 *   una alternativa al LLM (recover) hasta maxRecoveryAttempts. El contenido de
 *   la página viaja como datos (§37), nunca como instrucciones privilegiadas.
 * - Límites del job (§35) y dominio (§37) se aplican en cada paso; el loop está
 *   acotado por maxSteps y corta al alcanzar maxItems.
 */
import { AIOrchestrator } from '@ai-scraper/ai';
import { CommandValidator } from '@ai-scraper/commands';
import { DEFAULT_LIMITS } from '@ai-scraper/core';
import { ExecutionEngine } from '@ai-scraper/execution-engine';
import { generatePlan, type PlanJobInput, type PlanAction } from './planner';

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
    const engine = this.deps.createEngine ? this.deps.createEngine() : new ExecutionEngine();
    const modelOpts = job.ai?.model ? { model: job.ai.model } : undefined;
    let planActions: PlanAction[];
    const visited = () => [...engine.getMemory().visited];

    const steps: AgentStep[] = [];
    const items: unknown[] = [];
    let recoveryCount = 0;
    let browserEscalationSuggested = false;

    const observe = async (): Promise<{
      url: string;
      title: string;
      links: Array<{ text: string; href: string }>;
      elements: Array<{ type: string; selector: string; text: string }>;
      depth: number;
    }> => {
      const url = engine.getCurrentUrl() ?? job.url;
      const depth = engine.getMemory().visited.length;
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
        return { url, title: data.title ?? '', links, elements, depth };
      } catch {
        return { url, title: '', links: [], elements: [], depth };
      }
    };

    const recoverAndExecute = async (
      failedCommand: Record<string, unknown>,
      error: string,
    ): Promise<{ ok: boolean; command: Record<string, unknown>; count?: number; error?: string; needsBrowser?: boolean; usedBrowser?: boolean; resItems?: unknown[] } | null> => {
      for (let attempt = 1; attempt <= this.maxRecoveryAttempts; attempt += 1) {
        const ctx = await observe();
        let alternatives: unknown[];
        try {
          alternatives = await this.deps.orchestrator.recover(
            { ...ctx, instruction: job.instruction, failedCommand, error, ...(job.ai?.model ? { model: job.ai.model } : {}) },
            modelOpts,
          );
        } catch (e) {
          error = `recovery LLM falló (intento ${attempt}): ${(e as Error).message}`;
          continue;
        }
        const candidate = (Array.isArray(alternatives) ? alternatives[0] : alternatives) as Record<string, unknown>;
        if (!candidate || typeof candidate !== 'object') {
          error = `recovery devolvió decisión vacía (intento ${attempt})`;
          continue;
        }
        try {
          const valid = validator.validateCommand(candidate) as unknown as PlanAction;
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
      let command: Record<string, unknown>;
      try {
        command = validator.validateCommand(raw) as unknown as Record<string, unknown>;
      } catch (e) {
        const err = `validación rechazada: ${(e as Error).message}`;
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
      if (res.needsBrowser || res.usedBrowser) browserEscalationSuggested = true;
      if (res.ok) {
        return { n, command, ok: true, count: res.count, needsBrowser: res.needsBrowser, usedBrowser: res.usedBrowser, resItems: res.items };
      }
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
    let plan: PlanAction[];
    try {
      const generated = await generatePlan(job, { orchestrator: this.deps.orchestrator });
      plan = generated.actions;
      planActions = generated.actions;
      base.providerName = generated.providerName;
      base.model = generated.model;
    } catch (e) {
      return { ...base, status: 'FAILED', error: `No se pudo generar el plan: ${(e as Error).message}` };
    }

    for (const action of plan) {
      if (steps.length >= this.maxSteps) break;
      const step = await attemptStep(action as Record<string, unknown>);
      steps.push(step);
      if (!step.ok) {
        return {
          ...base, items, steps, recoveryCount, browserEscalationSuggested, planActions, visitedUrls: visited(),
          status: 'FAILED', error: `Paso ${step.n} (${String((step.command as { type?: string }).type)}) falló: ${step.error}`,
        };
      }
      pushItems((step as { resItems?: unknown[] }).resItems, String((step.command as { type?: string }).type));
      if (String((step.command as { type?: string }).type) === 'FINISH') {
        return { ...base, items, steps, recoveryCount, browserEscalationSuggested, planActions, visitedUrls: visited(), status: 'COMPLETED' };
      }
      if (items.length >= limits.maxItems) {
        return {
          ...base, items, steps, recoveryCount, browserEscalationSuggested, planActions, visitedUrls: visited(),
          status: 'COMPLETED', note: `Límite maxItems (${limits.maxItems}) alcanzado`,
        };
      }
    }

    // ---- Fase B: bucle dinámico §47 ----
    while (steps.length < this.maxSteps) {
      const ctx = await observe();
      let decisions: unknown[];
      try {
        decisions = await this.deps.orchestrator.analyzePage(
          { ...ctx, instruction: job.instruction, ...(job.ai?.model ? { model: job.ai.model } : {}) },
          modelOpts,
        );
      } catch (e) {
        return {
          ...base, items, steps, recoveryCount, browserEscalationSuggested, planActions, visitedUrls: visited(),
          status: items.length > 0 ? 'COMPLETED' : 'FAILED',
          ...(items.length > 0
            ? { note: `analyzePage falló pero hay ${items.length} items: ${(e as Error).message}` }
            : { error: `analyzePage falló: ${(e as Error).message}` }),
        };
      }
      const decision = (Array.isArray(decisions) ? decisions[0] : decisions) as Record<string, unknown>;
      if (!decision || typeof decision !== 'object') {
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
        return {
          ...base, items, steps, recoveryCount, browserEscalationSuggested, planActions, visitedUrls: visited(),
          status: 'FAILED', error: `Paso ${step.n} falló: ${step.error}`,
        };
      }
      pushItems((step as { resItems?: unknown[] }).resItems, String((step.command as { type?: string }).type));
      if (String((step.command as { type?: string }).type) === 'FINISH') {
        return { ...base, items, steps, recoveryCount, browserEscalationSuggested, planActions, visitedUrls: visited(), status: 'COMPLETED' };
      }
      if (items.length >= limits.maxItems) {
        return {
          ...base, items, steps, recoveryCount, browserEscalationSuggested, planActions, visitedUrls: visited(),
          status: 'COMPLETED', note: `Límite maxItems (${limits.maxItems}) alcanzado`,
        };
      }
    }

    if (items.length > 0) {
      return {
        ...base, items, steps, recoveryCount, browserEscalationSuggested,
        status: 'COMPLETED', note: `maxSteps (${this.maxSteps}) alcanzado con ${items.length} items parciales`,
      };
    }
    return {
      ...base, items, steps, recoveryCount, browserEscalationSuggested,
      status: 'FAILED', error: `maxSteps (${this.maxSteps}) alcanzado sin FINISH ni items`,
    };
  }
}
