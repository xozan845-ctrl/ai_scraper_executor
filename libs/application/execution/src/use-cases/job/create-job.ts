import { createHash } from 'node:crypto';
import type { JobLimits } from '@ai-scraper/domain-execution';
import type { OutputSchema, RenderOptions } from '@ai-scraper/domain-scraper';
import type { CreateJobInput, JobRecord } from '../../dtos/job';
import type { ScrapingJobPayload } from '../../dtos/scraping-job';
import type { JobQueue } from '../../ports/job-queue';
import type { JobStore } from '../../ports/job-store';
import type { JobMetrics } from '../../ports/job-metrics';
import { JobEnqueueError } from './errors';
import { assertJobUrlAllowed, assertWebhookUrlAllowed, type JobUrlPolicy } from './job-url-policy';
import { toJobView, type JobView } from './job-view';

export interface CreateJobCommand {
  url: string;
  instruction: string;
  limits?: JobLimits;
  ai?: { provider?: string; model?: string };
  priority?: number;
  idempotencyKey?: string;
  sessionId?: string;
  scope?: string;
  correlationId?: string;
  webhookUrl?: string;
  render?: RenderOptions;
  outputSchema?: OutputSchema;
}

export interface CreateJobDeps {
  store: JobStore;
  queue: JobQueue;
  policy: JobUrlPolicy;
  metrics?: JobMetrics;
}

/**
 * Crea la fila (QUEUED) y encola el payload. Si la cola falla, el job queda
 * FAILED con el error registrado: nunca un job fantasma.
 */
export class CreateJobUseCase {
  constructor(private readonly deps: CreateJobDeps) {}

  async execute(command: CreateJobCommand): Promise<JobView> {
    const scope = command.scope ?? 'anon';
    const idempotencyKey = command.idempotencyKey
      ? createHash('sha256').update(`${scope}\0${command.idempotencyKey}`).digest('hex')
      : null;
    assertJobUrlAllowed(command.url, this.deps.policy);
    if (command.webhookUrl) assertWebhookUrlAllowed(command.webhookUrl, this.deps.policy);

    const input: CreateJobInput = {
      url: command.url,
      instruction: command.instruction,
      limits: command.limits,
      aiProvider: command.ai?.provider ?? 'openrouter',
      aiModel: command.ai?.model,
      sessionId: command.sessionId,
      ownerScope: scope,
      ...(command.webhookUrl ? { webhookUrl: command.webhookUrl } : {}),
      ...(command.render ? { render: command.render } : {}),
      ...(command.outputSchema ? { outputSchema: command.outputSchema } : {}),
    };
    const created = idempotencyKey
      ? await this.deps.store.getOrCreateJob(input, idempotencyKey)
      : { record: await this.deps.store.createJob(input), created: true };
    const record = created.record;

    if (!created.created) {
      console.log(`[JOB] ${record.id} reutilizado (idempotency-key)`);
      return toJobView(record);
    }

    try {
      await this.deps.queue.enqueue(this.toPayload(record, command));
    } catch (error) {
      const message = `Enqueue fallido: ${(error as Error).message}`;
      await this.deps.store.saveError(record.id, message);
      await this.deps.store.updateStatus(record.id, 'FAILED');
      throw new JobEnqueueError(`Job creado pero no encolado: ${(error as Error).message}`);
    }

    console.log(`[JOB] ${record.id} QUEUED — ${record.url} :: ${record.instruction.slice(0, 80)}`);
    this.deps.metrics?.inc('jobs_created_total');
    return toJobView(record);
  }

  private toPayload(record: JobRecord, command: CreateJobCommand): ScrapingJobPayload {
    return {
      jobId: record.id,
      url: record.url,
      instruction: record.instruction,
      limits: (record.limits as Record<string, number>) ?? undefined,
      ai: { provider: record.aiProvider, model: record.aiModel },
      ...(command.priority !== undefined ? { priority: command.priority } : {}),
      ...(command.correlationId ? { correlationId: command.correlationId } : {}),
    };
  }
}
