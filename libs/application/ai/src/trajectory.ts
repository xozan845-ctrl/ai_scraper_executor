/**
 * Construcción y análisis de la trayectoria del bucle Fase B.
 * Puro, sin efectos colaterales, para testear con property-based.
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
const MAX_ERROR_LEN = 300;

export function buildTrajectory(
  steps: TrajectoryStep[],
  itemsCount: number,
  visitedUrls: string[],
  maxSteps = MAX_STEPS
): Trajectory {
  const recent = steps.slice(-maxSteps).map((s) => ({
    type: s.type,
    ok: s.ok,
    ...(s.count !== undefined ? { count: s.count } : {}),
    ...(s.selector ? { selector: s.selector.slice(0, MAX_SELECTOR_LEN) } : {}),
    ...(s.url ? { url: s.url } : {}),
    ...(s.error ? { error: s.error.slice(0, MAX_ERROR_LEN) } : {}),
  }));
  return {
    steps: recent,
    itemsCount,
    visitedUrls: visitedUrls.slice(-maxSteps),
  };
}

export function detectOscillation(
  trajectory: Trajectory,
  nextCommand: Record<string, unknown>
): boolean {
  const type = nextCommand.type as string;
  const selector = (nextCommand.selector ?? nextCommand.url) as string | undefined;

  for (const step of trajectory.steps) {
    if (step.type !== type) continue;
    if (selector && step.selector && step.selector === selector) return true;
    if (selector && step.url && step.url === selector) return true;
  }

  if (selector) {
    const urlVisits = trajectory.visitedUrls.filter((u) => u === selector).length;
    if (urlVisits >= 2) return true;
  }

  return false;
}

export function buildStepRecord(
  command: Record<string, unknown>,
  ok: boolean,
  count?: number,
  error?: string
): TrajectoryStep {
  return {
    type: command.type as string,
    ok,
    ...(count !== undefined ? { count } : {}),
    ...(command.selector ? { selector: command.selector as string } : {}),
    ...(command.url ? { url: command.url as string } : {}),
    ...(error ? { error } : {}),
  };
}