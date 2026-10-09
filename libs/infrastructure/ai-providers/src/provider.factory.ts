import { OpenRouterProvider } from './openrouter/openrouter.provider';
import { CustomEndpointProvider } from './custom/custom.provider';
import { FallbackAIProvider } from './fallback.provider';

/**
 * Provider Factory §14 + selección por job §18 + fallback §19.
 *
 * - Por defecto: OpenRouter (§15).
 * - `AI_PROVIDER=custom` o `jobAi.provider='custom'` → endpoint propio (§16).
 * - `createFallbackProvider()` encadena primario → secundario si el secundario
 *   está configurado (tiene endpoint / API key).
 */
export type ProviderKind = 'openrouter' | 'custom';

export interface JobAiSelection {
  provider?: ProviderKind | string;
  model?: string;
}

export function resolveProviderKind(kind?: string): ProviderKind {
  const resolved = (kind ?? process.env.AI_PROVIDER ?? 'openrouter').toLowerCase();
  return resolved === 'custom' ? 'custom' : 'openrouter';
}

export function createAIProvider(kind?: string) {
  if (resolveProviderKind(kind) === 'custom') return CustomEndpointProvider.fromEnv();
  return OpenRouterProvider.fromEnv();
}

/** Construcción del proveedor para un job concreto §18 (el modelo se usa por llamada vía opts/context). */
export function createAIProviderForJob(jobAi?: JobAiSelection) {
  return createAIProvider(jobAi?.provider);
}

function tryCreate(kind: ProviderKind) {
  try {
    return createAIProvider(kind);
  } catch {
    return null;
  }
}

/**
 * Primario según `primaryKind`/env; secundario el otro si está configurado.
 * Si no hay secundario válido, devuelve el primario sin envolver.
 */
export function createFallbackProvider(primaryKind?: string) {
  const primary = resolveProviderKind(primaryKind);
  const secondary: ProviderKind = primary === 'custom' ? 'openrouter' : 'custom';
  const first = tryCreate(primary);
  if (!first) throw new Error(`No se pudo construir el proveedor primario "${primary}" (revisa .env)`);
  const second = tryCreate(secondary);
  if (!second) return first;
  return new FallbackAIProvider([first, second] as never[]);
}
