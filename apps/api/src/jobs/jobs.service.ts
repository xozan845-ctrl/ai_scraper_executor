import { Injectable, Inject, InternalServerErrorException } from '@nestjs/common';
import type { JobStore } from '@ai-scraper/storage';
import type { JobQueue } from '@ai-scraper/queue';
import { metrics } from '@ai-scraper/observability';
import { JOB_STORE, JOB_QUEUE } from './providers';
import { CreateJobDto } from './dto/create-job.dto';

/**
 * JobsService — FASE 8: persistencia + cola reales.
 * - POST crea la fila (QUEUED) y encola el payload para el worker.
 * - Si la cola falla, el job queda FAILED con error registrado (nunca fantasma).
 */
@Injectable()
export class JobsService {
  constructor(
    @Inject(JOB_STORE) private readonly store: JobStore,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  async create(dto: CreateJobDto) {
    const record = await this.store.createJob({
      url: dto.url,
      instruction: dto.instruction,
      limits: dto.limits,
      aiProvider: dto.ai?.provider ?? 'openrouter',
      aiModel: dto.ai?.model,
    });
    try {
      await this.queue.enqueue({
        jobId: record.id,
        url: record.url,
        instruction: record.instruction,
        limits: (record.limits as Record<string, number>) ?? undefined,
        ai: { provider: record.aiProvider, model: record.aiModel },
      });
    } catch (e) {
      await this.store.saveError(record.id, `Enqueue fallido: ${(e as Error).message}`);
      await this.store.updateStatus(record.id, 'FAILED');
      throw new InternalServerErrorException(`Job creado pero no encolado: ${(e as Error).message}`);
    }
    console.log(`[JOB] ${record.id} QUEUED — ${dto.url} :: ${dto.instruction.slice(0, 80)}`);
    metrics().inc('jobs_created_total');
    return record;
  }

  findOne(id: string) {
    return this.store.getJob(id);
  }

  list(limit?: number) {
    const n = Math.min(Math.max(Number(limit) || 20, 1), 100);
    return this.store.listJobs(n);
  }

  async results(id: string) {
    const job = await this.store.getJob(id);
    if (!job) return null;
    const rows = await this.store.getResults(id);
    return {
      jobId: id,
      status: job.status,
      count: rows.length,
      items: rows.map((r) => {
        if (r.data && typeof r.data === 'object' && !Array.isArray(r.data)) {
          return { ...(r.data as Record<string, unknown>), ...(r.sourceUrl ? { _source: { url: r.sourceUrl, selector: r.selector } } : {}) };
        }
        return r.data;
      }),
    };
  }

  async execution(id: string) {
    const job = await this.store.getJob(id);
    if (!job) return null;
    const [commands, pages, errors] = await Promise.all([
      this.store.getCommands(id),
      this.store.getPages(id),
      this.store.getErrors(id),
    ]);
    return { jobId: id, status: job.status, commands, pages, errors };
  }

  async cancel(id: string) {
    const job = await this.store.getJob(id);
    if (!job) return null;
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status)) return job;
    await this.queue.remove(id).catch(() => false);
    metrics().inc('jobs_cancelled_total');
    return this.store.updateStatus(id, 'CANCELLED');
  }

  async aiInteractions(id: string) {
    const job = await this.store.getJob(id);
    if (!job) return null;
    return { jobId: id, provider: job.aiProvider, model: job.aiModel, calls: await this.store.getAIInteractions(id) };
  }

  /** Agregados DB + proceso para dashboard y /metrics (§56). */
  async stats() {
    const stats = await this.store.getStats();
    const recoveryRate = stats.commandsTotal > 0 ? stats.commandsRecovered / stats.commandsTotal : 0;
    return {
      store: this.store.kind,
      queue: this.queue.kind,
      pendingJobs: await this.queue.pendingCount().catch(() => -1),
      stats,
      aiRecoveryRate: Math.round(recoveryRate * 10000) / 10000,
      process: metrics().snapshot(),
    };
  }
}
