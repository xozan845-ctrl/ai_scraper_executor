import type { JobMetrics } from '../../ports/job-metrics';
import type { ScheduleLock } from '../../ports/schedule-lock';
import type { ScheduleStore } from '../../ports/schedule-store';
import type { JobUrlPolicy } from '../job/job-url-policy';
import { CreateJobUseCase } from '../job/create-job';
import { ControlScheduleUseCase } from './control-schedule';
import { CreateScheduleUseCase } from './create-schedule';
import { RunDueSchedulesUseCase } from './run-due-schedules';
import { ScheduleQueries } from './schedule-queries';

export * from './errors';
export * from './create-schedule';
export * from './schedule-queries';
export * from './control-schedule';
export * from './run-due-schedules';

export interface ScheduleUseCaseDeps {
  store: ScheduleStore;
  createJob: CreateJobUseCase;
  lock: ScheduleLock;
  policy: JobUrlPolicy;
  metrics?: JobMetrics;
  now?: () => number;
}

export interface ScheduleUseCases {
  create: CreateScheduleUseCase;
  queries: ScheduleQueries;
  control: ControlScheduleUseCase;
  runDue: RunDueSchedulesUseCase;
}

export function createScheduleUseCases(deps: ScheduleUseCaseDeps): ScheduleUseCases {
  return {
    ...createScheduleCrudUseCases(deps),
    runDue: new RunDueSchedulesUseCase(deps),
  };
}

export interface ScheduleCrudUseCases {
  create: CreateScheduleUseCase;
  queries: ScheduleQueries;
  control: ControlScheduleUseCase;
}

/** Composition mínima para la API (sin scheduler ni lock). */
export function createScheduleCrudUseCases(
  deps: Pick<ScheduleUseCaseDeps, 'store' | 'policy' | 'now'>,
): ScheduleCrudUseCases {
  return {
    create: new CreateScheduleUseCase(deps),
    queries: new ScheduleQueries(deps),
    control: new ControlScheduleUseCase(deps),
  };
}
