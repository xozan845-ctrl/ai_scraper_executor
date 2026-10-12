/**
 * Heurística (A, bloque 1): ¿el HTML es de una página que necesita render JS?
 * Pura y determinista: mide texto visible y detecta marcadores de SPA.
 */

const SPA_MARKERS = [
  /<div[^>]+id=["'](?:root|app|__next|__nuxt)["']/i,
  /ng-version=/i,
  /data-reactroot/i,
  /window\.__NUXT__/i,
  /window\.__NEXT_DATA__/i,
];

const JS_REQUIRED = /<noscript[^>]*>[^<]*(?:enable|activar|habilitar)\s+javascript/i;

/** Longitud del texto visible: sin scripts, estilos, etiquetas ni entidades. */
export function visibleTextLength(html: string): number {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim().length;
}

export function hasSpaMarker(html: string): boolean {
  return SPA_MARKERS.some((pattern) => pattern.test(html));
}

function countScripts(html: string): number {
  return (html.match(/<script\b/gi) ?? []).length;
}

/** true cuando la página casi seguro requiere JS para mostrar su contenido. */
export function needsBrowserRender(html: string): boolean {
  if (!html || html.length < 50) return false;
  if (JS_REQUIRED.test(html)) return true;
  const text = visibleTextLength(html);
  if (text >= 500) return false;
  return text < 200 && (hasSpaMarker(html) || countScripts(html) >= 5);
}
