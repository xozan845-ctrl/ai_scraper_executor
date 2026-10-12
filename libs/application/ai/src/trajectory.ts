/**
 * Memoria de trayectoria del bucle Observe→Think→Act (ADR-35).
 * Funciones **puras** (sin I/O): dan al LLM el historial de lo ya intentado para
 * evitar oscilaciones (repetir comandos fallidos) y navegación circular.
 */

export interface TrajectoryStep {
  type: string;
  ok: boolean;
  count?: number;
  selector?: string;
  url?: string;
  error?: string;
}

export interface Trajectory {
  steps: TrajectoryStep[];
  itemsCount: number;
  visitedUrls: string[];
}

const MAX_STEPS = 8;
const MAX_SELECTOR_LEN = 200;
const MAX_URL_LEN = 300;
const MAX_ERROR_LEN = 300;

/** Recorta a `max` si es un string no vacío; devuelve undefined en otro caso. */
function clip(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return value.length > max ? value.slice(0, max) : value;
}

/** Acota la trayectoria a los últimos `maxSteps` pasos y recorta los strings largos. */
export function buildTrajectory(
  steps: TrajectoryStep[],
  itemsCount: number,
  visitedUrls: string[],
  maxSteps = MAX_STEPS,
): Trajectory {
  const recent = steps.slice(Math.max(0, steps.length - Math.max(1, maxSteps))).map((step) => {
    const out: TrajectoryStep = { type: step.type, ok: step.ok };
    if (typeof step.count === 'number') out.count = step.count;
    const selector = clip(step.selector, MAX_SELECTOR_LEN);
    if (selector) out.selector = selector;
    const url = clip(step.url, MAX_URL_LEN);
    if (url) out.url = url;
    const error = clip(step.error, MAX_ERROR_LEN);
    if (error) out.error = error;
    return out;
  });
  return { steps: recent, itemsCount, visitedUrls: [...visitedUrls] };
}

/**
 * ¿El próximo comando repetiría un intento ya fallido (mismo type + selector/url),
 * o navegaría a una URL ya visitada ≥2 veces? Solo compara contra pasos `ok:false`.
 */
export function detectOscillation(trajectory: Trajectory, nextCommand: Record<string, unknown>): boolean {
  const type = typeof nextCommand.type === 'string' ? nextCommand.type : undefined;
  const selector = clip(nextCommand.selector, MAX_SELECTOR_LEN);
  const url = clip(nextCommand.url, MAX_URL_LEN);

  if (type) {
    const repeatsFailure = trajectory.steps.some((step) => {
      if (step.ok || step.type !== type) return false;
      if (selector !== undefined) return step.selector === selector;
      if (url !== undefined) return step.url === url;
      return step.selector === undefined && step.url === undefined;
    });
    if (repeatsFailure) return true;
  }

  if (url !== undefined && trajectory.visitedUrls.filter((v) => v === url).length >= 2) return true;
  return false;
}

/** Convierte un comando ejecutado en un registro de trayectoria (recortando strings). */
export function buildStepRecord(
  command: Record<string, unknown>,
  ok: boolean,
  count?: number,
  error?: string,
): TrajectoryStep {
  const type = typeof command.type === 'string' ? command.type : String(command.type ?? 'UNKNOWN');
  const record: TrajectoryStep = { type, ok };
  if (typeof count === 'number') record.count = count;
  const selector = clip(command.selector, MAX_SELECTOR_LEN);
  if (selector) record.selector = selector;
  const url = clip(command.url, MAX_URL_LEN);
  if (url) record.url = url;
  const err = clip(error, MAX_ERROR_LEN);
  if (err) record.error = err;
  return record;
}
