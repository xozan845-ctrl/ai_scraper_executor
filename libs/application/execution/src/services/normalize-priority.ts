export function normalizePriority(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return 5;
  return Math.min(10, Math.max(1, Math.round(value)));
}
