/**
 * Interpretación de resultados (FASE INTERPRET): normaliza valores, calcula
 * confianza por completitud y deduplica items entre páginas.
 * Determinista (sin LLM); el LLM `interpret` es opcional y se aplica una vez
 * al lote final cuando AI_INTERPRET=1.
 */

interface TracedValue {
  value?: unknown;
  normalized?: unknown;
  currency?: string;
  source?: Record<string, unknown>;
}

const PRICE_RE = /^\s*(?:([$€£])\s*)?([\d.,]+)\s*(?:([$€£])\s*)?$/;
const CURRENCY: Record<string, string> = { $: 'USD', '€': 'EUR', '£': 'GBP' };

/** Parsea números en formato US (1,250.00) o EU (1.250,00 / 9,99). */
function parseNumber(raw: string): number | null {
  const s = raw.trim();
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  let normalized = s;
  if (hasDot && hasComma) {
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    normalized = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (hasComma) {
    const parts = s.split(',');
    const frac = parts[parts.length - 1];
    // coma con 1-2 dígitos finales = decimal (EU); si no, separador de miles
    normalized = parts.length === 2 && frac.length <= 2 ? s.replace(',', '.') : s.replace(/,/g, '');
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function normalizeValue(value: unknown): { normalized?: unknown; currency?: string } {
  if (typeof value !== 'string') return {};
  const s = value.trim();
  if (!s) return {};
  const m = s.match(PRICE_RE);
  if (m) {
    const num = parseNumber(m[2]);
    if (num !== null) {
      const cur = m[1] ?? m[3];
      return { normalized: num, ...(cur ? { currency: CURRENCY[cur] ?? cur } : {}) };
    }
  }
  // Entero/decimal puro → número
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const num = Number(s);
    if (Number.isFinite(num)) return { normalized: num };
  }
  return {};
}

/** Enriquece un item: añade `normalized`/`currency` a cada TracedValue y `_source.confidence`. */
export function enrichItem(item: unknown): unknown {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  const src = item as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };
  let total = 0;
  let present = 0;
  for (const [k, v] of Object.entries(src)) {
    if (k === '_source') continue;
    total += 1;
    if (v && typeof v === 'object' && 'value' in (v as TracedValue)) {
      const tv = v as TracedValue;
      if (tv.value !== null && tv.value !== undefined && tv.value !== '') present += 1;
      const norm = normalizeValue(tv.value);
      if (norm.normalized !== undefined) {
        out[k] = { ...tv, normalized: norm.normalized, ...(norm.currency ? { currency: norm.currency } : {}) };
      }
    } else if (v !== null && v !== undefined && v !== '') {
      present += 1;
    }
  }
  const confidence = total > 0 ? Math.round((present / total) * 100) / 100 : 0;
  if (out._source && typeof out._source === 'object') {
    out._source = { ...(out._source as Record<string, unknown>), confidence };
  }
  return out;
}

/** Clave de negocio para deduplicar (link si existe; si no, concatenación de valores). */
function dedupeKey(item: unknown): string {
  if (!item || typeof item !== 'object') return JSON.stringify(item);
  const obj = item as Record<string, unknown>;
  const link = obj.link as TracedValue | undefined;
  if (link && typeof link.value === 'string' && link.value) return `link:${link.value}`;
  const vals = Object.entries(obj)
    .filter(([k]) => k !== '_source')
    .map(([, v]) => (v && typeof v === 'object' && 'value' in (v as TracedValue) ? (v as TracedValue).value : v))
    .join('|');
  return `vals:${vals}`;
}

/** Deduplica (por clave de negocio) y enriquece (normaliza + confianza). */
export function enrichItems(items: unknown[]): unknown[] {
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const it of items) {
    const key = dedupeKey(it);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(enrichItem(it));
  }
  return out;
}
