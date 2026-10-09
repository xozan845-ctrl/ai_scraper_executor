/**
 * OpenRouterProvider §15 — proveedor predeterminado.
 * Habla con OpenRouter API (OpenAI-compatible /chat/completions).
 * Todo el core usa la interfaz AIProvider; este adaptador es intercambiable.
 */
import { postChatCompletions, parseJsonResponse } from '../http';
import type { ProviderCallOpts, ProviderStats } from '../types';
import {
  PLAN_SYSTEM_PROMPT,
  ANALYZE_SYSTEM_PROMPT,
  RECOVER_SYSTEM_PROMPT,
  INTERPRET_SYSTEM_PROMPT,
} from '../prompts';

export interface OpenRouterConfig {
  apiKey: string;
  model: string;
  /** Modelos fallback en orden de preferencia (si el principal falla 404/429) */
  fallbackModels?: string[];
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  maxRetries?: number;
}

function num(env: string | undefined, fallback: number): number {
  const n = Number(env);
  return Number.isFinite(n) ? n : fallback;
}

export class OpenRouterProvider {
  readonly name = 'openrouter';
  private lastStats: ProviderStats | null = null;

  constructor(private readonly config: OpenRouterConfig) {
    if (!config.apiKey) throw new Error('OPENROUTER_API_KEY requerido (§15)');
  }

  getLastStats(): ProviderStats | null {
    return this.lastStats;
  }

  private resolveModel(context: { model?: string }, opts?: ProviderCallOpts): string {
    return opts?.model ?? context.model ?? this.config.model;
  }

  private getModelChain(model: string): string[] {
    return [model, ...(this.config.fallbackModels ?? [])];
  }

  private async chatWithFallback(system: string, userPayload: unknown, primaryModel: string, opts?: ProviderCallOpts): Promise<string> {
    const models = this.getModelChain(primaryModel);
    let lastError: Error | null = null;

    for (const model of models) {
      try {
        return await this.chat(system, userPayload, model, opts);
      } catch (e) {
        lastError = e as Error;
        const msg = (e as Error).message;
        // Solo reintentar en 404 (modelo no disponible) o 429 (rate limit)
        if (msg.includes('404') || msg.includes('429')) {
          console.warn(`[OpenRouter] Modelo "${model}" falló (${msg}), probando siguiente...`);
          continue;
        }
        // Otros errores: no reintentar
        throw e;
      }
    }
    throw lastError ?? new Error('Todos los modelos fallaron');
  }

  private async chat(system: string, userPayload: unknown, model: string, opts?: ProviderCallOpts): Promise<string> {
    const baseUrl = this.config.baseUrl ?? 'https://openrouter.ai/api/v1';
    const result = await postChatCompletions({
      url: `${baseUrl.replace(/\/$/, '')}/chat/completions`,
      label: 'OpenRouter',
      apiKey: this.config.apiKey,
      model,
      temperature: this.config.temperature ?? 0.1,
      maxTokens: Math.max(1, Math.min(this.config.maxTokens ?? 4000, opts?.maxTokens ?? Infinity)),
      system,
      userPayload,
      timeoutMs: Math.max(1, Math.min(this.config.timeoutMs ?? 60000, opts?.timeoutMs ?? Infinity)),
      maxRetries: this.config.maxRetries ?? 2,
      signal: opts?.signal,
    });
    this.lastStats = { latencyMs: result.latencyMs, tokens: result.tokens, model, provider: this.name };
    return result.content;
  }

  async createPlan(context: Record<string, unknown>, opts?: ProviderCallOpts) {
    const raw = await this.chatWithFallback(
      PLAN_SYSTEM_PROMPT,
      context,
      this.resolveModel(context as { model?: string }, opts),
      opts,
    );
    return parseJsonResponse('OpenRouter', raw);
  }

  async analyzePage(context: Record<string, unknown>, opts?: ProviderCallOpts) {
    const raw = await this.chatWithFallback(
      ANALYZE_SYSTEM_PROMPT,
      context,
      this.resolveModel(context as { model?: string }, opts),
      opts,
    );
    return [parseJsonResponse('OpenRouter', raw)];
  }

  async recover(context: Record<string, unknown>, opts?: ProviderCallOpts) {
    const raw = await this.chatWithFallback(
      RECOVER_SYSTEM_PROMPT,
      context,
      this.resolveModel(context as { model?: string }, opts),
      opts,
    );
    return [parseJsonResponse('OpenRouter', raw)];
  }

  async interpret(context: Record<string, unknown>, opts?: ProviderCallOpts) {
    const raw = await this.chatWithFallback(
      INTERPRET_SYSTEM_PROMPT,
      context,
      this.resolveModel(context as { model?: string }, opts),
      opts,
    );
    return parseJsonResponse('OpenRouter', raw);
  }

static fromEnv(): OpenRouterProvider {
    return new OpenRouterProvider({
      apiKey: process.env.OPENROUTER_API_KEY ?? '',
      model: process.env.OPENROUTER_MODEL ?? 'openrouter/free',
      fallbackModels: (process.env.OPENROUTER_FALLBACK_MODELS ?? '').split(',').map(s => s.trim()).filter(Boolean),
      baseUrl: process.env.OPENROUTER_BASE_URL,
      temperature: num(process.env.AI_TEMPERATURE, 0.1),
      maxTokens: num(process.env.AI_MAX_TOKENS, 4000),
      timeoutMs: num(process.env.AI_TIMEOUT_MS, 60000),
      maxRetries: num(process.env.AI_MAX_RETRIES, 2),
    });
  }
}
