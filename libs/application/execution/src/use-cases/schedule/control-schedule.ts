import type { ScheduleView } from '../../dtos/schedule';
import type { ScheduleStore } from '../../ports/schedule-store';
import { toScheduleView } from './schedule-view';

export interface ControlScheduleDeps {
  store: ScheduleStore;
  now?: () => number;
}

/** Pausa, reanuda y elimina schedules respetando ownership. */
export class ControlScheduleUseCase {
  constructor(private readonly deps: ControlScheduleDeps) {}

  async pause(id: string, scope = 'anon'): Promise<ScheduleView | null> {
    const record = await this.deps.store.getSchedule(id, scope);
    if (!record) return null;
    if (record.status !== 'ACTIVE') return toScheduleView(record);
    const updated = await this.deps.store.updateSchedule(id, { status: 'PAUSED' });
    return updated ? toScheduleView(updated) : null;
  }

  async resume(id: string, scope = 'anon'): Promise<ScheduleView | null> {
    const record = await this.deps.store.getSchedule(id, scope);
    if (!record) return null;
    const now = this.deps.now?.() ?? Date.now();
    const updated = await this.deps.store.updateSchedule(id, {
      status: 'ACTIVE',
      nextRunAt: new Date(now + record.intervalSec * 1000).toISOString(),
      lastError: undefined,
    });
    return updated ? toScheduleView(updated) : null;
  }

  async remove(id: string, scope = 'anon'): Promise<boolean> {
    return this.deps.store.deleteSchedule(id, scope);
  }
}
