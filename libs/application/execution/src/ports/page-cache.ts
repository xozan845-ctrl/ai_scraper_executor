/**
 * Caché de páginas aceptada por el motor (`R-HX-11`). El consumidor es el
 * engine; las implementaciones (memoria/Redis) viven en infraestructura y se
 * inyectan desde el composition root.
 *
 * La clave la deriva el engine: incluye el scope de credenciales, de modo que
 * el HTML autenticado de un contexto nunca se sirve a otro. Las
 * implementaciones tratan la clave como opaca y la normalizan cuando es una
 * URL válida.
 */
export interface EnginePageCache {
  get(key: string): string | null | Promise<string | null>;
  set(key: string, html: string): void | Promise<void>;
  hits?: number;
  misses?: number;
  size?: number;
}
