import { Injectable, Inject, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { assertPublicUrl, isAllowedHost } from '@ai-scraper/security';
import type { JobStore } from '@ai-scraper/storage';
import type { JobQueue } from '@ai-scraper/queue';
import { metrics, getContext } from '@ai-scraper/observability';
import { getMetricsAggregator } from '@ai-scraper/redis';
import { JOB_STORE, JOB_QUEUE } from './providers';
import { CreateJobDto } from './dto/create-job.dto';

/** Dominios permitidos vía env ALLOWED_DOMAINS (coma-separados). Vacío = cualquier host público. */
function allowedDomains(): string[] {
  return (process.env.ALLOWED_DOMAINS ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

export function assertJobUrlAllowed(url: string): void {
  let parsed: URL;
  try {
    parsed = assertPublicUrl(url);
  } catch (e) {
    throw new BadRequestException(`URL rechazada: ${(e as Error).message}`);
  }
  const allow = allowedDomains();
  if (allow.length > 0 && !allow.some((d) => isAllowedHost(parsed.hostname, d))) {
    throw new BadRequestException(`Dominio no permitido (ALLOWED_DOMAINS): ${parsed.hostname}`);
  }
}

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
    // ETAPA 4: SSRF + allowlist ANTES de persistir (nunca jobs fantasma ni SSRF).
    assertJobUrlAllowed(dto.url);
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
        // FASE 11: prioridad del DTO (1..10, defecto 5).
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        // Etapa 3: correlación API→worker.
        ...(getContext().correlationId ? { correlationId: getContext().correlationId } : {}),
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

  /** Reencola un job FAILED (replay manual / DLQ). Limpia artefactos previos. */
  async retry(id: string) {
    const job = await this.store.getJob(id);
    if (!job) return null;
    if (job.status !== 'FAILED') return job; // solo se reintentan fallidos
    await this.store.clearJobArtifacts(id);
    await this.store.updateStatus(id, 'QUEUED');
    await this.queue.enqueue({
      jobId: job.id,
      url: job.url,
      instruction: job.instruction,
      limits: (job.limits as Record<string, number>) ?? undefined,
      ai: { provider: job.aiProvider, model: job.aiModel },
      ...(getContext().correlationId ? { correlationId: getContext().correlationId } : {}),
    });
    metrics().inc('jobs_retried_total');
    return this.store.getJob(id);
  }

  async aiInteractions(id: string, limit = 50) {
    const job = await this.store.getJob(id);
    if (!job) return null;
    const n = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const calls = (await this.store.getAIInteractions(id)).slice(-n);
    return { jobId: id, provider: job.aiProvider, model: job.aiModel, count: calls.length, calls };
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
}
