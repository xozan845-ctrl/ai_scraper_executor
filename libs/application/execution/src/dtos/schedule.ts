import type { JobLimits } from '@ai-scraper/domain-execution';
import type { RenderOptions } from '@ai-scraper/domain-scraper';

export type ScheduleStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED';

export interface CreateScheduleInput {
  url: string;
  instruction: string;
  limits?: JobLimits;
  aiProvider?: string;
  aiModel?: string;
  webhookUrl?: string;
  render?: RenderOptions;
  ownerScope?: string;
  intervalSec: number;
  maxRuns?: number;
  /** Lo calcula el caso de uso al crear; el store lo persiste. */
  nextRunAt?: string;
}

export interface ScheduleRecord extends CreateScheduleInput {
  id: string;
  status: ScheduleStatus;
  runCount: number;
  nextRunAt: string;
  lastRunAt?: string;
  lastJobId?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export type SchedulePatch = Partial<Pick<
  ScheduleRecord,
  'status' | 'runCount' | 'nextRunAt' | 'lastRunAt' | 'lastJobId' | 'lastError'
>>;

export type ScheduleView = Omit<ScheduleRecord, 'ownerScope'>;
