/** Validadores semánticos del esquema de salida (P3). */
import type { FieldSchema } from '@ai-scraper/domain-scraper';

export type { FieldSchema, FieldType, OutputSchema } from '@ai-scraper/domain-scraper';

export interface FieldValidation {
  valid: boolean;
  present: boolean;
  errors: string[];
  normalized?: unknown;
  currency?: string;
}

const PRICE_RE = /^\s*(?:([$€£])\s*)?([\d.,]+)\s*(?:([$€£])\s*)?$/;
const CURRENCY: Record<string, string> = { $: 'USD', '€': 'EUR', '£': 'GBP' };

/** Parsea números en formato US (1,250.00) o EU (1.250,00 / 9,99). */
export function parseNumber(raw: string): number | null {
  const value = raw.trim();
  const hasDot = value.includes('.');
  const hasComma = value.includes(',');
  let normalized = value;
  if (hasDot && hasComma) {
    const lastDot = value.lastIndexOf('.');
    const lastComma = value.lastIndexOf(',');
    normalized = lastComma > lastDot ? value.replace(/\./g, '').replace(',', '.') : value.replace(/,/g, '');
  } else if (hasComma) {
    const parts = value.split(',');
    const fraction = parts[parts.length - 1]!;
    normalized = parts.length === 2 && fraction.length <= 2 ? value.replace(',', '.') : value.replace(/,/g, '');
  }
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function parsePrice(value: string): { number: number; currency?: string } | null {
  const match = value.match(PRICE_RE);
  if (!match) return null;
  const number = parseNumber(match[2]!);
  if (number === null) return null;
  const symbol = match[1] ?? match[3];
  return { number, ...(symbol ? { currency: CURRENCY[symbol] ?? symbol } : {}) };
}

function missing(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

/** Valida y normaliza un valor según el esquema. Sin esquema infiere números/precios. */
export function validateField(raw: unknown, schema?: FieldSchema): FieldValidation {
  const errors: string[] = [];
  if (missing(raw)) {
    if (schema?.required) errors.push('required');
    return { valid: errors.length === 0, present: false, errors };
  }

  const type = schema?.type;
  let normalized: unknown;
  let currency: string | undefined;
  const text = toText(raw).replace(/\s+/g, ' ').trim();

  if (type === 'price') {
    const parsed = parsePrice(text);
    if (!parsed) errors.push('price inválido');
    else { normalized = parsed.number; currency = parsed.currency; }
  } else if (type === 'number') {
    const parsed = parseNumber(text);
    if (parsed === null) errors.push('número inválido');
    else normalized = parsed;
  } else if (type === 'url') {
    try {
      const url = new URL(text);
      if (!['http:', 'https:'].includes(url.protocol)) errors.push('protocolo no permitido');
      else normalized = url.toString();
    } catch {
      errors.push('URL inválida');
    }
  } else if (type === 'date') {
    const timestamp = Date.parse(text);
    if (Number.isNaN(timestamp)) errors.push('fecha inválida');
    else normalized = new Date(timestamp).toISOString();
  } else if (type === 'email') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) errors.push('email inválido');
  } else if (type === 'boolean') {
    if (/^(true|1|si|sí|yes)$/i.test(text)) normalized = true;
    else if (/^(false|0|no)$/i.test(text)) normalized = false;
    else errors.push('booleano inválido');
  } else if (type === 'string') {
    normalized = text;
  } else {
    const parsed = parsePrice(text);
    if (parsed) { normalized = parsed.number; currency = parsed.currency; }
    else if (/^-?\d+(\.\d+)?$/.test(text)) normalized = Number(text);
  }

  const comparable = normalized !== undefined ? normalized : text;
  if (typeof comparable === 'number') {
    if (schema?.min !== undefined && comparable < schema.min) errors.push(`min ${schema.min}`);
    if (schema?.max !== undefined && comparable > schema.max) errors.push(`max ${schema.max}`);
  }
  if (schema?.pattern) {
    try {
      if (!new RegExp(schema.pattern).test(text)) errors.push('pattern');
    } catch {
      errors.push('pattern inválido');
    }
  }
  if (schema?.enum && !schema.enum.includes(text)) errors.push('enum');

  return {
    valid: errors.length === 0,
    present: true,
    errors,
    ...(normalized !== undefined ? { normalized } : {}),
    ...(currency ? { currency } : {}),
  };
}

export function sourceReliability(kind: unknown): number {
  if (kind === 'jsonld' || kind === 'microdata' || kind === 'opengraph') return 1;
  if (kind === 'network') return 0.95;
  return 0.9;
}
