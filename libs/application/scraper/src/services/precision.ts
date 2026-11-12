/**
 * Evaluador de precisión de extracción (P1). Compara lo esperado con lo
 * extraído por campo, sin red ni LLM. Base para el golden set por dominio.
 */

export interface PrecisionOptions {
  /** Campo de identidad para emparejar items (p. ej. `link` o `sku`). */
  matchBy?: string;
  caseInsensitive?: boolean;
  /** Tolerancia absoluta al comparar números. */
  numericTolerance?: number;
}

export interface ExpectedItem {
  fields: Record<string, unknown>;
}

export interface PrecisionDataset {
  expected: ExpectedItem[];
  actual: unknown[];
  options?: PrecisionOptions;
}

export interface FieldPrecision {
  expected: number;
  correct: number;
  missing: number;
  wrong: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface ItemsPrecision {
  expected: number;
  actual: number;
  matched: number;
  missing: number;
  extra: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface PrecisionReport {
  items: ItemsPrecision;
  fields: Record<string, FieldPrecision>;
  overall: {
    precision: number;
    recall: number;
    f1: number;
    fillRate: number;
    wrongValueRate: number;
  };
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 10000) / 10000 : 0;
}

function f1(precision: number, recall: number): number {
  return precision + recall > 0 ? Math.round((2 * precision * recall / (precision + recall)) * 10000) / 10000 : 0;
}

function normalizeString(value: string, caseInsensitive: boolean): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return caseInsensitive ? normalized.toLowerCase() : normalized;
}

function isMissing(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function readField(item: unknown, field: string): unknown {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
  const raw = (item as Record<string, unknown>)[field];
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'value' in (raw as Record<string, unknown>)) {
    const traced = raw as { value?: unknown; normalized?: unknown };
    return traced.normalized !== undefined ? traced.normalized : traced.value;
  }
  return raw;
}

function valuesEqual(expected: unknown, actual: unknown, options: Required<Pick<PrecisionOptions, 'caseInsensitive' | 'numericTolerance'>>): boolean {
  if (isMissing(expected) || isMissing(actual)) return isMissing(expected) && isMissing(actual);

  const expectedNumber = typeof expected === 'number'
    ? expected
    : (typeof expected === 'string' && expected.trim() !== '' && Number.isFinite(Number(expected)) ? Number(expected) : null);
  const actualNumber = typeof actual === 'number'
    ? actual
    : (typeof actual === 'string' && actual.trim() !== '' && Number.isFinite(Number(actual)) ? Number(actual) : null);
  if (expectedNumber !== null && actualNumber !== null) {
    return Math.abs(expectedNumber - actualNumber) <= options.numericTolerance;
  }

  if (typeof expected === 'string' && typeof actual === 'string') {
    return normalizeString(expected, options.caseInsensitive) === normalizeString(actual, options.caseInsensitive);
  }
  if (typeof expected === 'boolean' || typeof actual === 'boolean') return expected === actual;
  return JSON.stringify(expected) === JSON.stringify(actual);
}

function keyFromItem(item: unknown, field: string, caseInsensitive: boolean): string | null {
  const value = readField(item, field);
  if (isMissing(value)) return null;
  return normalizeString(String(value), caseInsensitive);
}

/** Evalúa un dataset expected/actual y devuelve métricas por item y por campo. */
export function evaluatePrecision(dataset: PrecisionDataset): PrecisionReport {
  const options = {
    caseInsensitive: dataset.options?.caseInsensitive ?? false,
    numericTolerance: dataset.options?.numericTolerance ?? 0,
  };
  const matchBy = dataset.options?.matchBy;
  const expectedItems = dataset.expected;
  const actualItems = dataset.actual;

  const actualByKey = new Map<string, unknown>();
  const usedActual = new Set<number>();
  if (matchBy) {
    for (const actual of actualItems) {
      const key = keyFromItem(actual, matchBy, options.caseInsensitive);
      if (key && !actualByKey.has(key)) actualByKey.set(key, actual);
    }
  }

  const matched: Array<{ expected: ExpectedItem; actual: unknown | undefined }> = [];
  for (let index = 0; index < expectedItems.length; index += 1) {
    const expectation = expectedItems[index]!;
    let actual: unknown | undefined;
    if (matchBy) {
      const expectedKey = keyFromItem(expectation.fields, matchBy, options.caseInsensitive);
      actual = expectedKey ? actualByKey.get(expectedKey) : undefined;
      if (actual !== undefined) {
        const actualIndex = actualItems.indexOf(actual);
        if (actualIndex >= 0) usedActual.add(actualIndex);
      }
    } else {
      actual = actualItems[index];
      if (actual !== undefined) usedActual.add(index);
    }
    matched.push({ expected: expectation, actual });
  }

  const fields: Record<string, FieldPrecision> = {};
  let totalExpectedFields = 0;
  let totalCorrect = 0;
  let totalMissing = 0;
  let totalWrong = 0;

  for (const { expected, actual } of matched) {
    for (const [field, expectedValue] of Object.entries(expected.fields)) {
      const metric = fields[field] ?? { expected: 0, correct: 0, missing: 0, wrong: 0, precision: 0, recall: 0, f1: 0 };
      metric.expected += 1;
      totalExpectedFields += 1;
      if (actual === undefined) {
        metric.missing += 1;
        totalMissing += 1;
      } else {
        const actualValue = readField(actual, field);
        if (isMissing(actualValue)) {
          metric.missing += 1;
          totalMissing += 1;
        } else if (valuesEqual(expectedValue, actualValue, options)) {
          metric.correct += 1;
          totalCorrect += 1;
        } else {
          metric.wrong += 1;
          totalWrong += 1;
        }
      }
      fields[field] = metric;
    }
  }

  for (const metric of Object.values(fields)) {
    metric.precision = ratio(metric.correct, metric.correct + metric.wrong);
    metric.recall = ratio(metric.correct, metric.expected);
    metric.f1 = f1(metric.precision, metric.recall);
  }

  const extra = actualItems.length - usedActual.size;
  const missingItems = expectedItems.length - matched.filter((row) => row.actual !== undefined).length;
  const matchedItems = expectedItems.length - missingItems;
  const itemPrecision = ratio(matchedItems, matchedItems + extra);
  const itemRecall = ratio(matchedItems, expectedItems.length);
  const precision = ratio(totalCorrect, totalCorrect + totalWrong);
  const recall = ratio(totalCorrect, totalExpectedFields);

  return {
    items: {
      expected: expectedItems.length,
      actual: actualItems.length,
      matched: matchedItems,
      missing: missingItems,
      extra,
      precision: itemPrecision,
      recall: itemRecall,
      f1: f1(itemPrecision, itemRecall),
    },
    fields,
    overall: {
      precision,
      recall,
      f1: f1(precision, recall),
      fillRate: ratio(totalExpectedFields - totalMissing, totalExpectedFields),
      wrongValueRate: ratio(totalWrong, totalExpectedFields),
    },
  };
}
