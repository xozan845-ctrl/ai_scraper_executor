import type { ScheduleView } from '../../dtos/schedule';
import type { ScheduleStore } from '../../ports/schedule-store';
import { toScheduleView } from './schedule-view';

export interface ScheduleQueriesDeps {
  store: ScheduleStore;
}

export class ScheduleQueries {
  constructor(private readonly deps: ScheduleQueriesDeps) {}

  async findOne(id: string, scope = 'anon'): Promise<ScheduleView | null> {
    const record = await this.deps.store.getSchedule(id, scope);
    return record ? toScheduleView(record) : null;
  }

  async list(limit?: number, scope = 'anon'): Promise<ScheduleView[]> {
    const size = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const records = await this.deps.store.listSchedules(size, scope);
    return records.map(toScheduleView);
  }
}
