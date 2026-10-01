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

  private async chat(system: string, userPayload: unknown, model: string): Promise<string> {
    const baseUrl = this.config.baseUrl ?? 'https://openrouter.ai/api/v1';
    const result = await postChatCompletions({
      url: `${baseUrl.replace(/\/$/, '')}/chat/completions`,
      label: 'OpenRouter',
      apiKey: this.config.apiKey,
      model,
      temperature: this.config.temperature ?? 0.1,
      maxTokens: this.config.maxTokens ?? 4000,
      system,
      userPayload,
      timeoutMs: this.config.timeoutMs ?? 60000,
      maxRetries: this.config.maxRetries ?? 2,
    });
    this.lastStats = { latencyMs: result.latencyMs, tokens: result.tokens, model, provider: this.name };
    return result.content;
  }

  async createPlan(context: Record<string, unknown>, opts?: ProviderCallOpts) {
    const raw = await this.chat(
      PLAN_SYSTEM_PROMPT,
      context,
      this.resolveModel(context as { model?: string }, opts),
    );
    return parseJsonResponse('OpenRouter', raw);
  }

  async analyzePage(context: Record<string, unknown>, opts?: ProviderCallOpts) {
    const raw = await this.chat(
      ANALYZE_SYSTEM_PROMPT,
      context,
      this.resolveModel(context as { model?: string }, opts),
    );
    return [parseJsonResponse('OpenRouter', raw)];
  }

  async recover(context: Record<string, unknown>, opts?: ProviderCallOpts) {
    const raw = await this.chat(
      RECOVER_SYSTEM_PROMPT,
      context,
      this.resolveModel(context as { model?: string }, opts),
    );
    return [parseJsonResponse('OpenRouter', raw)];
  }

  async interpret(context: Record<string, unknown>, opts?: ProviderCallOpts) {
    const raw = await this.chat(
      INTERPRET_SYSTEM_PROMPT,
      context,
      this.resolveModel(context as { model?: string }, opts),
    );
    return parseJsonResponse('OpenRouter', raw);
  }

  static fromEnv(): OpenRouterProvider {
    return new OpenRouterProvider({
      apiKey: process.env.OPENROUTER_API_KEY ?? '',
      model: process.env.OPENROUTER_MODEL ?? 'anthropic/claude-3.5-sonnet',
      baseUrl: process.env.OPENROUTER_BASE_URL,
      temperature: num(process.env.AI_TEMPERATURE, 0.1),
      maxTokens: num(process.env.AI_MAX_TOKENS, 4000),
      timeoutMs: num(process.env.AI_TIMEOUT_MS, 60000),
    });
  }
}
