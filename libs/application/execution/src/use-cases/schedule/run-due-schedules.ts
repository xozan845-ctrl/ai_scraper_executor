import type { ScheduleRecord } from '../../dtos/schedule';
import type { JobMetrics } from '../../ports/job-metrics';
import type { ScheduleLock } from '../../ports/schedule-lock';
import type { ScheduleStore } from '../../ports/schedule-store';
import { CreateJobUseCase } from '../job/create-job';

export interface RunDueSchedulesDeps {
  store: ScheduleStore;
  createJob: CreateJobUseCase;
  lock: ScheduleLock;
  metrics?: JobMetrics;
  now?: () => number;
}

export interface RunDueSchedulesResult {
  run: number;
  failed: number;
  skipped: number;
}

/**
 * Ejecuta los schedules vencidos: lock por schedule (evita doble enqueue entre
 * réplicas), crea el job, avanza `nextRunAt` y cierra al alcanzar `maxRuns`.
 */
export class RunDueSchedulesUseCase {
  constructor(private readonly deps: RunDueSchedulesDeps) {}

  async execute(limit = 50): Promise<RunDueSchedulesResult> {
    const nowMs = this.deps.now?.() ?? Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const due = await this.deps.store.findDue(nowIso, limit);
    const result: RunDueSchedulesResult = { run: 0, failed: 0, skipped: 0 };

    for (const schedule of due) {
      const lockKey = `schedule:${schedule.id}`;
      if (!(await this.deps.lock.acquire(lockKey, 30_000))) {
        result.skipped += 1;
        this.deps.metrics?.inc('schedules_skipped_total');
        continue;
      }
      try {
        await this.runOne(schedule, nowMs);
        result.run += 1;
        this.deps.metrics?.inc('schedules_run_total');
      } catch (error) {
        result.failed += 1;
        this.deps.metrics?.inc('schedules_failed_total');
        await this.deps.store.updateSchedule(schedule.id, {
          lastRunAt: nowIso,
          nextRunAt: this.nextRunAt(schedule, nowMs),
          lastError: (error as Error).message,
        }).catch(() => undefined);
      } finally {
        await this.deps.lock.release(lockKey).catch(() => undefined);
      }
    }
    return result;
  }

  private async runOne(schedule: ScheduleRecord, nowMs: number): Promise<void> {
    const job = await this.deps.createJob.execute({
      url: schedule.url,
      instruction: schedule.instruction,
      ...(schedule.limits ? { limits: schedule.limits } : {}),
      ai: { provider: schedule.aiProvider, model: schedule.aiModel },
      ...(schedule.webhookUrl ? { webhookUrl: schedule.webhookUrl } : {}),
      ...(schedule.render ? { render: schedule.render } : {}),
      scope: schedule.ownerScope ?? 'anon',
    });
    const runCount = schedule.runCount + 1;
    const completed = schedule.maxRuns !== undefined && runCount >= schedule.maxRuns;
    await this.deps.store.updateSchedule(schedule.id, {
      runCount,
      lastRunAt: new Date(nowMs).toISOString(),
      lastJobId: job.id,
      nextRunAt: this.nextRunAt(schedule, nowMs),
      status: completed ? 'COMPLETED' : 'ACTIVE',
    });
  }

  private nextRunAt(schedule: ScheduleRecord, nowMs: number): string {
    return new Date(nowMs + schedule.intervalSec * 1000).toISOString();
  }
}
