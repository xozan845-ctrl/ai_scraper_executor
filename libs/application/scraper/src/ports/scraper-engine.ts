import type { EngineMemory } from '@ai-scraper/domain-scraper';

/** Resultado de un comando del motor; refleja la forma pública del ExecutionEngine. */
export interface ExecutionStepResult {
  ok: boolean;
  commandType: string;
  items?: unknown[];
  count?: number;
  data?: unknown;
  error?: string;
  nextHint?: string;
  needsBrowser?: boolean;
  usedBrowser?: boolean;
  statusCode?: number;
}

/** Puerto del motor de scraping; el adaptador vive en `infrastructure/execution`. */
export interface ScraperEngine {
  execute(command: unknown): Promise<ExecutionStepResult>;
  getMemory(): EngineMemory;
  getCurrentUrl(): string | null;
}

export interface EngineFactoryHint {
  needsBrowser: boolean;
  allowedDomain: string;
  credentialOrigin: string;
  signal: AbortSignal;
  learnedSelectors: string[];
  /** Cabeceras de sesión ya descifradas en el borde. */
  headers?: Record<string, string>;
}

export type CreateScraperEngine = (hint: EngineFactoryHint) => ScraperEngine;
