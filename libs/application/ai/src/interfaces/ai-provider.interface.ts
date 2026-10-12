/**
 * AIProvider §14 — el core nunca depende de OpenRouter directamente.
 * OpenRouter es default (§15), custom endpoint opcional (§16).
 */
import type { Trajectory } from '../trajectory';

/** Selección de modelo por job §18: el job puede fijar el modelo en el contexto o en opts. */
export interface AIProviderCallOpts {
  /** Modelo a usar en esta llamada. Precedencia: opts.model > context.model > proveedor por defecto. */
  model?: string;
  /** Cancela la llamada cuando vence el job o el cliente aborta. */
  signal?: AbortSignal;
  /** Tope de tokens de salida para esta llamada. */
  maxTokens?: number;
  /** Timeout de esta llamada, siempre acotado por el deadline global. */
  timeoutMs?: number;
}

/** Stats por llamada para métricas §56 (ai_tokens, ai_latency). */
export interface AIProviderStats {
  latencyMs: number;
  tokens?: number;
  model: string;
  provider: string;
}

export interface PlanningContext {
  url: string;
  instruction: string;
  limits: Record<string, number>;
  model?: string;
}

export interface PageContext {
  url: string;
  title?: string;
  links: Array<{ text: string; href: string }>;
  elements: Array<{ type: string; selector: string; text: string }>;
  depth: number;
  instruction: string;
  model?: string;
  /** Extracto del texto visible (≤1000 car.), si el engine lo proporciona (ADR-35). */
  textSnippet?: string;
  /** Tamaño del HTML de la página en bytes, si el engine lo proporciona. */
  htmlLength?: number;
  /** Total de enlaces de la página, si el engine lo proporciona. */
  linksCount?: number;
  /** Historial acotado de pasos previos para anti-oscilación (ADR-35). */
  trajectory?: Trajectory;
}

export interface RecoveryContext extends PageContext {
  failedCommand: unknown;
  error: string;
}

export interface ResultContext {
  instruction: string;
  rawItems: unknown[];
  model?: string;
}

export interface AIProvider {
  readonly name: string;
  createPlan(context: PlanningContext, opts?: AIProviderCallOpts): Promise<unknown>;
  analyzePage(context: PageContext, opts?: AIProviderCallOpts): Promise<unknown[]>;
  recover(context: RecoveryContext, opts?: AIProviderCallOpts): Promise<unknown[]>;
  interpret(context: ResultContext, opts?: AIProviderCallOpts): Promise<unknown>;
  /** Última llamada (latencia/tokens/modelo). Opcional para no romper proveedores externos. */
  getLastStats?(): AIProviderStats | null;
}
