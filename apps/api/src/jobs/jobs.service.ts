import { Injectable, Inject, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import {
  assertJobUrlAllowed as assertJobUrlAllowedPolicy,
  createJobUseCases,
  JobEnqueueError,
  JobUrlRejectedError,
  type JobQueue,
  type JobStore,
  type JobUseCases,
} from '@ai-scraper/application-execution';
import { metrics, getContext } from '@ai-scraper/shared-observability';
import { getMetricsAggregator } from '@ai-scraper/infrastructure-redis';
import { JOB_STORE, JOB_QUEUE } from './providers';
import { CreateJobDto } from './dto/create-job.dto';
import { jobUrlPolicy } from './policy';

/** Adaptador HTTP del caso de uso de validación de URL (conserva la firma histórica). */
export function assertJobUrlAllowed(url: string): void {
  try {
    assertJobUrlAllowedPolicy(url, jobUrlPolicy());
  } catch (error) {
    if (error instanceof JobUrlRejectedError) throw new BadRequestException(error.message);
    throw error;
  }
}

/**
 * JobsService — adaptador Nest de los casos de uso de `application/execution`.
 * Traduce errores de aplicación a HTTP y conserva la composición de jobs.
 */
@Injectable()
export class JobsService {
  private readonly useCases: JobUseCases;

  constructor(
    @Inject(JOB_STORE) private readonly store: JobStore,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {
    this.useCases = createJobUseCases({
      store,
      queue,
      policy: jobUrlPolicy(),
      metrics: { inc: (name) => metrics().inc(name) },
    });
  }

  async create(dto: CreateJobDto, idempotencyKey?: string, sessionId?: string, scope = 'anon') {
    try {
      return await this.useCases.create.execute({
        url: dto.url,
        instruction: dto.instruction,
        limits: dto.limits,
        ai: dto.ai,
        priority: dto.priority,
        webhookUrl: dto.webhookUrl,
        render: dto.render,
        idempotencyKey,
        sessionId,
        scope,
        correlationId: getContext().correlationId,
      });
    } catch (error) {
      throw this.toHttpError(error);
    }
  }

  findOne(id: string, scope = 'anon') {
    return this.useCases.queries.findOne(id, scope);
  }

  list(limit?: number, opts?: { cursor?: string; status?: string }, scope = 'anon') {
    return this.useCases.queries.list(limit, opts, scope);
  }

  results(id: string, scope = 'anon') {
    return this.useCases.queries.results(id, scope);
  }

  execution(id: string, scope = 'anon') {
    return this.useCases.queries.execution(id, scope);
  }

  async cancel(id: string, scope = 'anon') {
    return this.useCases.cancel.execute(id, scope);
  }

  /** Reencola un job FAILED (replay manual / DLQ). Limpia artefactos previos. */
  async retry(id: string, scope = 'anon') {
    try {
      return await this.useCases.retry.execute(id, scope, getContext().correlationId);
    } catch (error) {
      throw this.toHttpError(error);
    }
  }

  aiInteractions(id: string, limit = 50, scope = 'anon') {
    return this.useCases.queries.aiInteractions(id, limit, scope);
  }

  /** Agregados DB + proceso para dashboard y /metrics (§56).
   * ETAPA 5: `stats` es global (Postgres); `process` es local a la réplica.
   * `distributed` agrega contadores de todas las réplicas/workers vía Redis.
   */
  async stats() {
    const stats = await this.store.getStats();
    const recoveryRate = stats.commandsTotal > 0 ? stats.commandsRecovered / stats.commandsTotal : 0;
    const collector = metrics();
    let distributed: Record<string, number>;
    try {
      distributed = await (await getMetricsAggregator()).getAllCounters();
    } catch {
      distributed = {};
    }
    return {
      instance: collector.instance,
      uptimeSec: collector.uptimeSec(),
      store: this.store.kind,
      queue: this.queue.kind,
      pendingJobs: await this.queue.pendingCount().catch(() => -1),
      stats,
      aiRecoveryRate: Math.round(recoveryRate * 10000) / 10000,
      process: collector.snapshot(),
      distributed,
    };
  }

  private toHttpError(error: unknown): unknown {
    if (error instanceof JobUrlRejectedError || error instanceof JobEnqueueError) {
      return error instanceof JobUrlRejectedError
        ? new BadRequestException(error.message)
        : new InternalServerErrorException(error.message);
    }
    return error;
  }
}
