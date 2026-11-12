/** Opciones de render con navegador para apps SPA (Angular/React/Vue/…). */
export interface RenderOptions {
  /** auto = solo si el HTML es fino o hay reto anti-bot; always/never fuerzan. */
  mode?: 'auto' | 'always' | 'never';
  /** Estado de carga de Playwright antes de capturar el DOM. */
  waitUntil?: 'domcontentloaded' | 'load' | 'networkidle';
  /** Selector que debe existir antes de capturar (p. ej. `app-root`). */
  waitForSelector?: string;
  /** Espera mínima adicional tras la carga. */
  waitMs?: number;
  /** Timeout de navegación/render. */
  timeoutMs?: number;
}
