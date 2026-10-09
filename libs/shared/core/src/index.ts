/**
 * @ai-scraper/shared-core — utilidades puras transversales.
 * Sin lógica de negocio ni dependencias de otras capas (`R-HX-1`).
 */

/**
 * Hash estable y barato del HTML (no criptográfico): solo detección de cambios/drift.
 * Fuente única compartida por crawler y mongodb.
 */
export function hashHtml(html: string): string {
  let hash = 0;
  for (let i = 0; i < html.length; i++) {
    hash = ((hash << 5) - hash + html.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}
