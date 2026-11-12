import type { JobRecord } from '../../dtos/job';

/** Proyección pública de un job: nunca expone `ownerScope`. */
export type JobView = Omit<JobRecord, 'ownerScope'>;

export function toJobView<T extends { ownerScope?: string }>(record: T): Omit<T, 'ownerScope'> {
  const { ownerScope: _ownerScope, ...view } = record;
  return view;
}
