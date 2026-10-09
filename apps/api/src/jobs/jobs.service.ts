import { Injectable, Inject, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { assertPublicUrl, isAllowedHost } from '@ai-scraper/shared-security';
import type { JobStore } from '@ai-scraper/infrastructure-storage';
import type { JobQueue } from '@ai-scraper/infrastructure-queue';
import { metrics, getContext } from '@ai-scraper/shared-observability';
import { getMetricsAggregator } from '@ai-scraper/infrastructure-redis';
import { createHash } from 'node:crypto';
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

  private publicJob<T extends { ownerScope?: string }>(record: T): Omit<T, 'ownerScope'> {
    const { ownerScope: _ownerScope, ...publicRecord } = record;
    return publicRecord;
  }

  private async ownedJob(id: string, scope: string) {
    const job = await this.store.getJob(id);
    return job?.ownerScope === scope ? job : null;
  }

  async create(dto: CreateJobDto, idempotencyKey?: string, sessionId?: string, scope = 'anon') {
    // Idempotencia con ámbito (scope = hash de API key/sesión): evita que la
    // misma clave de dos clientes distintos devuelva el job de otro.
    const idemKey = idempotencyKey
      ? createHash('sha256').update(`${scope}\0${idempotencyKey}`).digest('hex')
      : null;
    // ETAPA 4: SSRF + allowlist ANTES de persistir (nunca jobs fantasma ni SSRF).
    assertJobUrlAllowed(dto.url);
    const input = {
      url: dto.url,
      instruction: dto.instruction,
      limits: dto.limits,
      aiProvider: dto.ai?.provider ?? 'openrouter',
      aiModel: dto.ai?.model,
      sessionId,
      ownerScope: scope,
    };
    const created = idemKey
      ? await this.store.getOrCreateJob(input, idemKey)
      : { record: await this.store.createJob(input), created: true };
    const record = created.record;
    if (!created.created) {
      console.log(`[JOB] ${record.id} reutilizado (idempotency-key)`);
      return this.publicJob(record);
    }
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
    return this.publicJob(record);
  }

  async findOne(id: string, scope = 'anon') {
    const job = await this.ownedJob(id, scope);
    return job ? this.publicJob(job) : null;
  }

  list(limit?: number, opts?: { cursor?: string; status?: string }, scope = 'anon') {
    const n = Math.min(Math.max(Number(limit) || 20, 1), 100);
    return this.store.listJobs(n + 1, { ...opts, ownerScope: scope }).then((rows) => {
      const hasMore = rows.length > n;
      const items = (hasMore ? rows.slice(0, n) : rows).map((job) => this.publicJob(job));
      return {
        items,
        nextCursor: hasMore ? items[items.length - 1]!.id : null,
      };
    });
  }

  async results(id: string, scope = 'anon') {
    const job = await this.ownedJob(id, scope);
    if (!job) return null;
    const rows = await this.store.getResults(id);
    return {
      jobId: id,
      status: job.status,
      count: rows.length,
      items: rows.map((r) => {
        if (r.data && typeof r.data === 'object' && !Array.isArray(r.data)) {
          const data = r.data as Record<string, unknown>;
          const existingSource = data._source && typeof data._source === 'object' && !Array.isArray(data._source)
            ? data._source as Record<string, unknown>
            : {};
          return {
            ...data,
            ...(r.sourceUrl ? {
              _source: {
                ...existingSource,
                url: r.sourceUrl,
                selector: r.selector ?? existingSource.selector,
              },
            } : {}),
          };
        }
        return r.data;
      }),
    };
  }

  async execution(id: string, scope = 'anon') {
    const job = await this.ownedJob(id, scope);
    if (!job) return null;
    const [commands, pages, errors] = await Promise.all([
      this.store.getCommands(id),
      this.store.getPages(id),
      this.store.getErrors(id),
    ]);
    return { jobId: id, status: job.status, commands, pages, errors };
  }

  async cancel(id: string, scope = 'anon') {
    const job = await this.ownedJob(id, scope);
    if (!job) return null;
    if (['COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT'].includes(job.status)) return this.publicJob(job);
    await this.queue.remove(id).catch(() => false);
    metrics().inc('jobs_cancelled_total');
    const updated = await this.store.updateStatus(id, 'CANCELLED');
    return updated ? this.publicJob(updated) : null;
  }

  /** Reencola un job FAILED (replay manual / DLQ). Limpia artefactos previos. */
  async retry(id: string, scope = 'anon') {
    const job = await this.ownedJob(id, scope);
    if (!job) return null;
    if (!['FAILED', 'TIMEOUT'].includes(job.status)) return this.publicJob(job);
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
    const updated = await this.store.getJob(id);
    return updated ? this.publicJob(updated) : null;
  }

  async aiInteractions(id: string, limit = 50, scope = 'anon') {
    const job = await this.ownedJob(id, scope);
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
