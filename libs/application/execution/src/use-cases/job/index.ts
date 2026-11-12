import type { JobQueue } from '../../ports/job-queue';
import type { JobMetrics } from '../../ports/job-metrics';
import type { JobStore } from '../../ports/job-store';
import { CancelJobUseCase } from './cancel-job';
import { CreateJobUseCase } from './create-job';
import { JobQueries } from './job-queries';
import type { JobUrlPolicy } from './job-url-policy';
import { RetryJobUseCase } from './retry-job';

export * from './errors';
export * from './job-url-policy';
export * from './job-view';
export * from './create-job';
export * from './job-queries';
export * from './cancel-job';
export * from './retry-job';

export interface JobUseCaseDeps {
  store: JobStore;
  queue: JobQueue;
  policy: JobUrlPolicy;
  metrics?: JobMetrics;
}

export interface JobUseCases {
  create: CreateJobUseCase;
  queries: JobQueries;
  cancel: CancelJobUseCase;
  retry: RetryJobUseCase;
}

/** Composition de casos de uso de jobs; no instancia adaptadores (`R-HX-5`). */
export function createJobUseCases(deps: JobUseCaseDeps): JobUseCases {
  return {
    create: new CreateJobUseCase(deps),
    queries: new JobQueries(deps.store),
    cancel: new CancelJobUseCase(deps),
    retry: new RetryJobUseCase(deps),
  };
}
