import type { CreateScheduleInput, SchedulePatch, ScheduleRecord } from '../dtos/schedule';

export interface ScheduleStore {
  readonly kind: 'prisma' | 'memory';
  createSchedule(input: CreateScheduleInput): Promise<ScheduleRecord>;
  getSchedule(id: string, ownerScope?: string): Promise<ScheduleRecord | null>;
  listSchedules(limit?: number, ownerScope?: string): Promise<ScheduleRecord[]>;
  updateSchedule(id: string, patch: SchedulePatch): Promise<ScheduleRecord | null>;
  deleteSchedule(id: string, ownerScope?: string): Promise<boolean>;
  /** Schedules ACTIVE con nextRunAt <= now. */
  findDue(now: string, limit?: number): Promise<ScheduleRecord[]>;
}
