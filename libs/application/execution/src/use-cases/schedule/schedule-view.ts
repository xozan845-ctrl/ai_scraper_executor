import type { ScheduleRecord, ScheduleView } from '../../dtos/schedule';

export function toScheduleView(record: ScheduleRecord): ScheduleView {
  const { ownerScope: _ownerScope, ...view } = record;
  return view;
}
