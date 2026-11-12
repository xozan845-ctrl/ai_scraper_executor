import crypto from 'node:crypto';
import type {
  CreateScheduleInput,
  SchedulePatch,
  ScheduleRecord,
  ScheduleStatus,
  ScheduleStore,
} from '@ai-scraper/application-execution';
import { getPrismaClient } from './factory';

function toRecord(schedule: {
  id: string;
  url: string;
  instruction: string;
  limits: unknown;
  aiProvider: string;
  aiModel: string | null;
  webhookUrl: string | null;
  renderOptions?: unknown;
  ownerScope: string;
  intervalSec: number;
  maxRuns: number | null;
  runCount: number;
  status: string;
  nextRunAt: Date;
  lastRunAt: Date | null;
  lastJobId: string | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ScheduleRecord {
  return {
    id: schedule.id,
    url: schedule.url,
    instruction: schedule.instruction,
    limits: (schedule.limits as ScheduleRecord['limits']) ?? undefined,
    aiProvider: schedule.aiProvider,
    aiModel: schedule.aiModel ?? undefined,
    webhookUrl: schedule.webhookUrl ?? undefined,
    render: (schedule.renderOptions as ScheduleRecord['render']) ?? undefined,
    ownerScope: schedule.ownerScope,
    intervalSec: schedule.intervalSec,
    maxRuns: schedule.maxRuns ?? undefined,
    runCount: schedule.runCount,
    status: schedule.status as ScheduleStatus,
    nextRunAt: schedule.nextRunAt.toISOString(),
    lastRunAt: schedule.lastRunAt?.toISOString(),
    lastJobId: schedule.lastJobId ?? undefined,
    lastError: schedule.lastError ?? undefined,
    createdAt: schedule.createdAt.toISOString(),
    updatedAt: schedule.updatedAt.toISOString(),
  };
}

class MemoryScheduleStore implements ScheduleStore {
  readonly kind = 'memory' as const;
  private readonly schedules = new Map<string, ScheduleRecord>();

  async createSchedule(input: CreateScheduleInput): Promise<ScheduleRecord> {
    const now = new Date().toISOString();
    const record: ScheduleRecord = {
      ...input,
      id: `sched_${crypto.randomUUID()}`,
      ownerScope: input.ownerScope ?? 'anon',
      aiProvider: input.aiProvider ?? 'openrouter',
      status: 'ACTIVE',
      runCount: 0,
      nextRunAt: input.nextRunAt ?? new Date(Date.now() + input.intervalSec * 1000).toISOString(),
      createdAt: now,
      updatedAt: now,
    };
    this.schedules.set(record.id, record);
    return { ...record };
  }

  async getSchedule(id: string, ownerScope?: string): Promise<ScheduleRecord | null> {
    const record = this.schedules.get(id);
    if (!record || (ownerScope && record.ownerScope !== ownerScope)) return null;
    return { ...record };
  }

  async listSchedules(limit = 50, ownerScope?: string): Promise<ScheduleRecord[]> {
    return [...this.schedules.values()]
      .filter((record) => !ownerScope || record.ownerScope === ownerScope)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit)
      .map((record) => ({ ...record }));
  }

  async updateSchedule(id: string, patch: SchedulePatch): Promise<ScheduleRecord | null> {
    const record = this.schedules.get(id);
    if (!record) return null;
    const updated: ScheduleRecord = {
      ...record,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.schedules.set(id, updated);
    return { ...updated };
  }

  async deleteSchedule(id: string, ownerScope?: string): Promise<boolean> {
    const record = this.schedules.get(id);
    if (!record || (ownerScope && record.ownerScope !== ownerScope)) return false;
    return this.schedules.delete(id);
  }

  async findDue(now: string, limit = 50): Promise<ScheduleRecord[]> {
    return [...this.schedules.values()]
      .filter((record) => record.status === 'ACTIVE' && record.nextRunAt <= now)
      .sort((a, b) => (a.nextRunAt < b.nextRunAt ? -1 : 1))
      .slice(0, limit)
      .map((record) => ({ ...record }));
  }
}

class PrismaScheduleStore implements ScheduleStore {
  readonly kind = 'prisma' as const;
  private readonly prisma = getPrismaClient();

  async createSchedule(input: CreateScheduleInput): Promise<ScheduleRecord> {
    const created = await this.prisma.jobSchedule.create({
      data: {
        url: input.url,
        instruction: input.instruction,
        limits: (input.limits ?? undefined) as never,
        aiProvider: input.aiProvider ?? 'openrouter',
        aiModel: input.aiModel ?? null,
        webhookUrl: input.webhookUrl ?? null,
        renderOptions: (input.render ?? undefined) as never,
        ownerScope: input.ownerScope ?? 'anon',
        intervalSec: input.intervalSec,
        maxRuns: input.maxRuns ?? null,
        nextRunAt: new Date(input.nextRunAt ?? Date.now() + input.intervalSec * 1000),
      },
    });
    return toRecord(created);
  }

  async getSchedule(id: string, ownerScope?: string): Promise<ScheduleRecord | null> {
    const found = await this.prisma.jobSchedule.findFirst({
      where: { id, ...(ownerScope ? { ownerScope } : {}) },
    });
    return found ? toRecord(found) : null;
  }

  async listSchedules(limit = 50, ownerScope?: string): Promise<ScheduleRecord[]> {
    const rows = await this.prisma.jobSchedule.findMany({
      where: ownerScope ? { ownerScope } : {},
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(toRecord);
  }

  async updateSchedule(id: string, patch: SchedulePatch): Promise<ScheduleRecord | null> {
    const data: Record<string, unknown> = {};
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.runCount !== undefined) data.runCount = patch.runCount;
    if (patch.nextRunAt !== undefined) data.nextRunAt = new Date(patch.nextRunAt);
    if (patch.lastRunAt !== undefined) data.lastRunAt = new Date(patch.lastRunAt);
    if (patch.lastJobId !== undefined) data.lastJobId = patch.lastJobId;
    if (patch.lastError !== undefined) data.lastError = patch.lastError;
    const updated = await this.prisma.jobSchedule.update({ where: { id }, data });
    return toRecord(updated);
  }

  async deleteSchedule(id: string, ownerScope?: string): Promise<boolean> {
    const result = await this.prisma.jobSchedule.deleteMany({
      where: { id, ...(ownerScope ? { ownerScope } : {}) },
    });
    return result.count > 0;
  }

  async findDue(now: string, limit = 50): Promise<ScheduleRecord[]> {
    const rows = await this.prisma.jobSchedule.findMany({
      where: { status: 'ACTIVE', nextRunAt: { lte: new Date(now) } },
      orderBy: { nextRunAt: 'asc' },
      take: limit,
    });
    return rows.map(toRecord);
  }
}

/** Prisma si hay DATABASE_URL; memoria en dev/test; fail-fast en producción sin BD. */
export function createScheduleStore(): ScheduleStore {
  if (!process.env.DATABASE_URL) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('DATABASE_URL requerido para schedules en producción');
    }
    return new MemoryScheduleStore();
  }
  return new PrismaScheduleStore();
}
