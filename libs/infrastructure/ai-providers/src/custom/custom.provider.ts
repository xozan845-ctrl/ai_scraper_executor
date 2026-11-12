/**
 * CustomEndpointProvider §16 — Ollama / vLLM / LM Studio / servidor propio
 * con API compatible OpenAI /chat/completions.
 */
import { postChatCompletions, parseJsonResponse } from '../http';
import type { AIProviderCallOpts as ProviderCallOpts, AIProviderStats as ProviderStats } from '@ai-scraper/application-ai';
import {
  PLAN_SYSTEM_PROMPT,
  ANALYZE_SYSTEM_PROMPT,
  RECOVER_SYSTEM_PROMPT,
  INTERPRET_SYSTEM_PROMPT,
} from '../prompts';

export interface CustomConfig {
  endpoint: string;
  apiKey?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  maxRetries?: number;
}

function num(env: string | undefined, fallback: number): number {
  const n = Number(env);
  return Number.isFinite(n) ? n : fallback;
}

export class CustomEndpointProvider {
  readonly name = 'custom';
  private lastStats: ProviderStats | null = null;

  constructor(private readonly config: CustomConfig) {
    if (!config.endpoint) throw new Error('AI_CUSTOM_ENDPOINT requerido (§16)');
  }

  getLastStats(): ProviderStats | null {
    return this.lastStats;
  }

  private resolveModel(context: { model?: string }, opts?: ProviderCallOpts): string {
    return opts?.model ?? context.model ?? this.config.model;
  }

  private async chat(system: string, userPayload: unknown, model: string, opts?: ProviderCallOpts): Promise<string> {
    const result = await postChatCompletions({
      url: this.config.endpoint,
      label: 'CustomEndpoint',
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
    const raw = await this.chat(
      PLAN_SYSTEM_PROMPT,
      context,
      this.resolveModel(context as { model?: string }, opts),
      opts,
    );
    return parseJsonResponse('CustomEndpoint', raw);
  }

  async analyzePage(context: Record<string, unknown>, opts?: ProviderCallOpts) {
    const raw = await this.chat(
      ANALYZE_SYSTEM_PROMPT,
      context,
      this.resolveModel(context as { model?: string }, opts),
      opts,
    );
    return [parseJsonResponse('CustomEndpoint', raw)];
  }

  async recover(context: Record<string, unknown>, opts?: ProviderCallOpts) {
    const raw = await this.chat(
      RECOVER_SYSTEM_PROMPT,
      context,
      this.resolveModel(context as { model?: string }, opts),
      opts,
    );
    return [parseJsonResponse('CustomEndpoint', raw)];
  }

  async interpret(context: Record<string, unknown>, opts?: ProviderCallOpts) {
    const raw = await this.chat(
      INTERPRET_SYSTEM_PROMPT,
      context,
      this.resolveModel(context as { model?: string }, opts),
      opts,
    );
    return parseJsonResponse('CustomEndpoint', raw);
  }

  static fromEnv(): CustomEndpointProvider {
    return new CustomEndpointProvider({
      endpoint: process.env.AI_CUSTOM_ENDPOINT ?? '',
      apiKey: process.env.AI_CUSTOM_API_KEY,
      model: process.env.AI_CUSTOM_MODEL ?? 'custom-model',
      temperature: num(process.env.AI_TEMPERATURE, 0.1),
      maxTokens: num(process.env.AI_MAX_TOKENS, 4000),
      timeoutMs: num(process.env.AI_TIMEOUT_MS, 60000),
    });
  }
}
