/**
 * Memoria de trayectoria del motor durante un job (ADR-35): URLs visitadas,
 * último paso y selectores aprendidos. Es estado del dominio de scraping, no
 * un detalle del adaptador de navegación.
 */
export interface EngineMemory {
  visited: string[];
  lastUrl: string | null;
  lastItems: number;
  discoveredSelectors: string[];
}
