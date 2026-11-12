import type { JobLimits } from '@ai-scraper/domain-execution';
import type { ScheduleView } from '../../dtos/schedule';
import type { ScheduleStore } from '../../ports/schedule-store';
import { assertJobUrlAllowed, assertWebhookUrlAllowed, type JobUrlPolicy } from '../job/job-url-policy';
import { ScheduleValidationError } from './errors';
import { toScheduleView } from './schedule-view';

export const MIN_INTERVAL_SEC = 10;
export const MAX_INTERVAL_SEC = 30 * 24 * 60 * 60;

export interface CreateScheduleCommand {
  url: string;
  instruction: string;
  limits?: JobLimits;
  ai?: { provider?: string; model?: string };
  webhookUrl?: string;
  intervalSec: number;
  maxRuns?: number;
  scope?: string;
}

export interface CreateScheduleDeps {
  store: ScheduleStore;
  policy: JobUrlPolicy;
  now?: () => number;
}

export class CreateScheduleUseCase {
  constructor(private readonly deps: CreateScheduleDeps) {}

  async execute(command: CreateScheduleCommand): Promise<ScheduleView> {
    assertJobUrlAllowed(command.url, this.deps.policy);
    if (command.webhookUrl) assertWebhookUrlAllowed(command.webhookUrl, this.deps.policy);

    const intervalSec = Math.floor(command.intervalSec);
    if (!Number.isFinite(intervalSec) || intervalSec < MIN_INTERVAL_SEC || intervalSec > MAX_INTERVAL_SEC) {
      throw new ScheduleValidationError(
        `intervalSec debe estar entre ${MIN_INTERVAL_SEC} y ${MAX_INTERVAL_SEC} segundos`,
      );
    }
    if (command.maxRuns !== undefined) {
      if (!Number.isInteger(command.maxRuns) || command.maxRuns < 1) {
        throw new ScheduleValidationError('maxRuns debe ser un entero >= 1');
      }
    }

    const now = this.deps.now?.() ?? Date.now();
    const record = await this.deps.store.createSchedule({
      url: command.url,
      instruction: command.instruction,
      ...(command.limits ? { limits: command.limits } : {}),
      aiProvider: command.ai?.provider ?? 'openrouter',
      ...(command.ai?.model ? { aiModel: command.ai.model } : {}),
      ...(command.webhookUrl ? { webhookUrl: command.webhookUrl } : {}),
      ownerScope: command.scope ?? 'anon',
      intervalSec,
      ...(command.maxRuns !== undefined ? { maxRuns: command.maxRuns } : {}),
      nextRunAt: new Date(now + intervalSec * 1000).toISOString(),
    });
    return toScheduleView(record);
  }
}
