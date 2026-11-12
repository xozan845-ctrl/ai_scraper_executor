import { PrismaClient } from '@prisma/client';
import type {
  JobStore,
  SaveResultInput,
  JobStatus,
  JobRecord,
  CreateJobInput,
  ResultRow,
  CommandRow,
  PageRow,
  ErrorRow,
  AIInteractionInput,
  AIInteractionRow,
  StoreStats,
  ListJobsOptions,
} from '@ai-scraper/application-execution';

const toRecord = (j: {
  id: string;
  url: string;
  instruction: string;
  status: string;
  limits: unknown;
  aiProvider: string;
  aiModel: string | null;
  webhookUrl?: string | null;
  sessionId?: string | null;
  ownerScope: string;
  createdAt: Date;
  updatedAt: Date;
}): JobRecord => ({
  id: j.id,
  url: j.url,
  instruction: j.instruction,
  status: j.status as JobStatus,
  limits: (j.limits as JobRecord['limits']) ?? undefined,
  aiProvider: j.aiProvider,
  aiModel: j.aiModel ?? undefined,
  webhookUrl: j.webhookUrl ?? undefined,
  sessionId: j.sessionId ?? undefined,
  ownerScope: j.ownerScope,
  createdAt: j.createdAt.toISOString(),
  updatedAt: j.updatedAt.toISOString(),
});

/** Store PostgreSQL vía Prisma (§11, §40). */
export class PrismaJobStore implements JobStore {
  readonly kind = 'prisma' as const;

  constructor(private readonly prisma: PrismaClient) {}

  async createJob(input: CreateJobInput): Promise<JobRecord> {
    const j = await this.prisma.job.create({
      data: {
        url: input.url,
        instruction: input.instruction,
        status: 'QUEUED',
        limits: (input.limits ?? {}) as never,
        aiProvider: input.aiProvider ?? 'openrouter',
        aiModel: input.aiModel,
        webhookUrl: input.webhookUrl ?? null,
        sessionId: input.sessionId ?? null,
        ownerScope: input.ownerScope ?? 'anon',
      },
    });
    return toRecord(j);
  }

  async getOrCreateJob(input: CreateJobInput, idempotencyKey: string): Promise<{ record: JobRecord; created: boolean }> {
    const existing = await this.prisma.job.findUnique({ where: { idempotencyKey } });
    if (existing) return { record: toRecord(existing), created: false };
    try {
      const created = await this.prisma.job.create({
        data: {
          url: input.url,
          instruction: input.instruction,
          status: 'QUEUED',
          limits: (input.limits ?? {}) as never,
          aiProvider: input.aiProvider ?? 'openrouter',
          aiModel: input.aiModel,
          webhookUrl: input.webhookUrl ?? null,
          sessionId: input.sessionId ?? null,
          ownerScope: input.ownerScope ?? 'anon',
          idempotencyKey,
        },
      });
      return { record: toRecord(created), created: true };
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      const raced = await this.prisma.job.findUnique({ where: { idempotencyKey } });
      if (!raced) throw error;
      return { record: toRecord(raced), created: false };
    }
  }

  async getJob(id: string): Promise<JobRecord | null> {
    const j = await this.prisma.job.findUnique({ where: { id } });
    return j ? toRecord(j) : null;
  }

  async listJobs(limit = 20, opts?: ListJobsOptions): Promise<JobRecord[]> {
    const rows = await this.prisma.job.findMany({
      where: {
        ...(opts?.status ? { status: opts.status } : {}),
        ...(opts?.ownerScope ? { ownerScope: opts.ownerScope } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      ...(opts?.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    return rows.map(toRecord);
  }

  async updateStatus(id: string, status: JobStatus): Promise<JobRecord | null> {
    try {
      const j = await this.prisma.job.update({ where: { id }, data: { status } });
      return toRecord(j);
    } catch {
      return null;
    }
  }

  async savePlan(jobId: string, payload: unknown): Promise<void> {
    await this.prisma.scrapingPlan.create({ data: { jobId, version: '1.0', payload: payload as never } });
  }

  async saveCommand(jobId: string, type: string, payload: unknown, status: string): Promise<void> {
    await this.prisma.command.create({ data: { jobId, type, payload: payload as never, status } });
  }

  async savePage(jobId: string, url: string, title?: string, depth?: number): Promise<void> {
    // Sin constraint única en (jobId,url): deduplicar por lectura.
    const existing = await this.prisma.page.findFirst({ where: { jobId, url } });
    if (!existing) await this.prisma.page.create({ data: { jobId, url, title, depth: depth ?? 0 } });
  }

  async saveResults(jobId: string, items: SaveResultInput[]): Promise<number> {
    if (items.length === 0) return 0;
    await this.prisma.result.createMany({
      data: items.map((it) => ({
        jobId,
        data: it.data as never,
        sourceUrl: it.sourceUrl,
        selector: it.selector,
        confidence: it.confidence,
      })),
    });
    return items.length;
  }

  async saveError(jobId: string, message: string, context?: unknown): Promise<void> {
    await this.prisma.jobError.create({ data: { jobId, message, context: (context ?? {}) as never } });
  }

  async saveAIInteraction(jobId: string, input: AIInteractionInput): Promise<void> {
    await this.prisma.aIInteraction.create({
      data: {
        jobId,
        provider: input.provider,
        model: input.model,
        kind: input.kind,
        request: (input.request ?? {}) as never,
        response: (input.response ?? {}) as never,
        tokens: input.tokens,
        latencyMs: input.latencyMs,
      },
    });
  }

  async getResults(jobId: string): Promise<ResultRow[]> {
    const rows = await this.prisma.result.findMany({ where: { jobId }, orderBy: { createdAt: 'asc' } });
    return rows.map((r) => ({
      id: r.id,
      data: r.data,
      sourceUrl: r.sourceUrl ?? undefined,
      selector: r.selector ?? undefined,
      confidence: r.confidence ?? undefined,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async getCommands(jobId: string): Promise<CommandRow[]> {
    const rows = await this.prisma.command.findMany({ where: { jobId }, orderBy: { createdAt: 'asc' } });
    return rows.map((c) => ({ id: c.id, type: c.type, payload: c.payload, status: c.status, createdAt: c.createdAt.toISOString() }));
  }

  async getPages(jobId: string): Promise<PageRow[]> {
    const rows = await this.prisma.page.findMany({ where: { jobId }, orderBy: { createdAt: 'asc' } });
    return rows.map((p) => ({ id: p.id, url: p.url, title: p.title ?? undefined, depth: p.depth, createdAt: p.createdAt.toISOString() }));
  }

  async getErrors(jobId: string): Promise<ErrorRow[]> {
    const rows = await this.prisma.jobError.findMany({ where: { jobId }, orderBy: { createdAt: 'asc' } });
    return rows.map((e) => ({ id: e.id, message: e.message, context: e.context, createdAt: e.createdAt.toISOString() }));
  }

  async getAIInteractions(jobId: string): Promise<AIInteractionRow[]> {
    const rows = await this.prisma.aIInteraction.findMany({ where: { jobId }, orderBy: { createdAt: 'asc' } });
    return rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      model: r.model ?? undefined,
      kind: r.kind,
      tokens: r.tokens ?? undefined,
      latencyMs: r.latencyMs ?? undefined,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async clearJobArtifacts(jobId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.scrapingPlan.deleteMany({ where: { jobId } }),
      this.prisma.command.deleteMany({ where: { jobId } }),
      this.prisma.page.deleteMany({ where: { jobId } }),
      this.prisma.result.deleteMany({ where: { jobId } }),
      this.prisma.jobError.deleteMany({ where: { jobId } }),
      this.prisma.aIInteraction.deleteMany({ where: { jobId } }),
    ]);
  }

  async getStats(): Promise<StoreStats> {
    const [jobsTotal, byStatus, resultsTotal, commandsTotal, commandsRecovered, pagesTotal, errorsTotal, aiCallsTotal, tokens] =
      await Promise.all([
        this.prisma.job.count(),
        this.prisma.job.groupBy({ by: ['status'], _count: { status: true } }),
        this.prisma.result.count(),
        this.prisma.command.count(),
        this.prisma.command.count({ where: { status: 'RECOVERED' } }),
        this.prisma.page.count(),
        this.prisma.jobError.count(),
        this.prisma.aIInteraction.count(),
        this.prisma.aIInteraction.aggregate({ _sum: { tokens: true } }),
      ]);
    const jobsByStatus: Record<string, number> = {};
    for (const row of byStatus) jobsByStatus[row.status] = row._count.status;
    return {
      jobsTotal,
      jobsByStatus,
      resultsTotal,
      commandsTotal,
      commandsRecovered,
      pagesTotal,
      errorsTotal,
      aiCallsTotal,
      aiTokensTotal: tokens._sum.tokens ?? 0,
    };
  }
}
