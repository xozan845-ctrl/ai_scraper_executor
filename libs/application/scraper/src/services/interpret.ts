/**
 * Interpretación de resultados (FASE INTERPRET + P3): normaliza valores,
 * valida contra el esquema de salida, calcula confianza compuesta y deduplica.
 */

import { sourceReliability, validateField, type OutputSchema } from './output-schema';

interface TracedValue {
  value?: unknown;
  normalized?: unknown;
  currency?: string;
  source?: Record<string, unknown>;
}

/** Clave de negocio para deduplicar (link si existe; si no, concatenación de valores). */
function dedupeKey(item: unknown): string {
  if (!item || typeof item !== 'object') return JSON.stringify(item);
  const obj = item as Record<string, unknown>;
  const link = obj.link as TracedValue | undefined;
  if (link && typeof link.value === 'string' && link.value) return `link:${link.value}`;
  const vals = Object.entries(obj)
    .filter(([key]) => key !== '_source')
    .map(([, value]) => (value && typeof value === 'object' && 'value' in (value as TracedValue) ? (value as TracedValue).value : value))
    .join('|');
  return `vals:${vals}`;
}

function isPresent(value: unknown): boolean {
  return value !== null && value !== undefined && value !== '';
}

/** Enriquece un item: normaliza, valida y calcula confianza real (0..1). */
export function enrichItem(item: unknown, schema?: OutputSchema): unknown {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  const source = item as Record<string, unknown>;
  const out: Record<string, unknown> = { ...source };
  const schemaFields = schema?.fields;
  const fieldErrors: Record<string, string[]> = {};
  let valid = true;

  let present = 0;
  let total = 0;
  let scoreSum = 0;
  let scoreCount = 0;

  for (const [key, value] of Object.entries(source)) {
    if (key === '_source') continue;
    const spec = schemaFields?.[key];
    const tracked = value && typeof value === 'object' && 'value' in (value as TracedValue);
    const rawValue = tracked ? (value as TracedValue).value : value;

    if (spec || (tracked && typeof rawValue === 'string')) {
      const validation = validateField(rawValue, spec);
      if (tracked) {
        out[key] = {
          ...(value as TracedValue),
          ...(validation.normalized !== undefined ? { normalized: validation.normalized } : {}),
          ...(validation.currency ? { currency: validation.currency } : {}),
          ...(spec ? { validation: { valid: validation.valid, present: validation.present, errors: validation.errors } } : {}),
        };
      }
      if (!validation.valid) {
        valid = false;
        fieldErrors[key] = validation.errors;
      }
    }

    if (spec) {
      scoreCount += 1;
      const validation = validateField(rawValue, spec);
      scoreSum += validation.present ? (validation.valid ? 1 : 0.5) : 0;
    } else {
      total += 1;
      if (isPresent(rawValue)) present += 1;
    }
  }

  if (schemaFields) {
    for (const [key, spec] of Object.entries(schemaFields)) {
      if (key in source) continue;
      const validation = validateField(undefined, spec);
      scoreCount += 1;
      if (!validation.valid) {
        valid = false;
        fieldErrors[key] = validation.errors;
      }
    }
  }

  const reliability = sourceReliability((source._source as Record<string, unknown> | undefined)?.kind);
  const confidence = schemaFields
    ? (scoreCount > 0 ? Math.round(((scoreSum / scoreCount) * reliability) * 100) / 100 : 0)
    : (total > 0 ? Math.round((present / total) * 100) / 100 : 0);

  if (out._source && typeof out._source === 'object') {
    out._source = {
      ...(out._source as Record<string, unknown>),
      confidence,
      ...(schemaFields
        ? { validation: { valid, errors: Object.values(fieldErrors).flat(), fields: fieldErrors } }
        : {}),
    };
  }
  return out;
}

/** Deduplica (por clave de negocio) y enriquece (normaliza + valida + confianza). */
export function enrichItems(items: unknown[], schema?: OutputSchema): unknown[] {
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const item of items) {
    const key = dedupeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(enrichItem(item, schema));
  }
  return out;
}
