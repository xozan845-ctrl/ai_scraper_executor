/**
 * Dedupe de items extraídos (J, bloque 2). Evita duplicados entre páginas
 * (paginación que repite la última tarjeta). Puro y determinista: la clave
 * es el contenido de los campos, nunca el sello `_source.scrapedAt`.
 */

/** Clave estable de identidad de un item (ignora `_source` y ordena campos). */
export function itemKey(item: unknown): string {
  if (!item || typeof item !== 'object') return JSON.stringify(item) ?? 'null';
  const row = item as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(row).sort()) {
    if (key === '_source') continue;
    const value = row[key];
    const extracted =
      value && typeof value === 'object' && !Array.isArray(value) && 'value' in (value as object)
        ? (value as { value: unknown }).value
        : value;
    parts.push(`${key}=${JSON.stringify(extracted ?? null)}`);
  }
  return parts.join('\u0001');
}

/** Quita duplicados conservando la primera aparición y el orden original. */
export function dedupeItems<T>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = itemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
