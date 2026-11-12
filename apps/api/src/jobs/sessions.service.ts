import { Injectable, Inject, BadRequestException, ConflictException, Optional } from '@nestjs/common';
import {
  createSessionUseCases,
  JobUrlRejectedError,
  SessionCredentialsUnavailableError,
  SessionNotReadyError,
  type SessionJobGateway,
  type SessionStore,
  type SessionUseCases,
  type SiteProfileReader,
} from '@ai-scraper/application-execution';
import { encryptJson, hasCredentialsKey } from '@ai-scraper/shared-security';
import { SESSION_STORE, RADIOGRAPHER, type Radiographer } from './providers';
import { JobsService } from './jobs.service';
import { jobUrlPolicy } from './policy';
import { CreateSessionDto, SendMessageDto } from './dto/session.dto';

/**
 * Sesiones tipo "chat": una URL + credenciales + historial.
 * Adaptador Nest de los casos de uso de `application/execution`.
 */
@Injectable()
export class SessionsService {
  private readonly useCases: SessionUseCases;

  constructor(
    @Inject(SESSION_STORE) sessions: SessionStore,
    private readonly jobs: JobsService,
    @Optional() @Inject(RADIOGRAPHER) radiographer?: Radiographer,
  ) {
    const runRadiography = radiographer ?? (async (url: string, headers?: Record<string, string>) => {
      const { runRadiography: run } = await import('./radiography-adapter');
      await run(url, { maxDepth: 2, maxPages: 10, forceBrowser: true, ...(headers ? { headers } : {}) });
    });

    const jobGateway: SessionJobGateway = {
      createJob: ({ url, instruction, sessionId, scope }) =>
        this.jobs.create({ url, instruction }, undefined, sessionId, scope),
      getJob: (id, scope) => this.jobs.findOne(id, scope),
      getResults: (id, scope) => this.jobs.results(id, scope),
    };

    const profileReader: SiteProfileReader = {
      getSummary: async (url) => {
        try {
          const { getLearnedProfile } = await import('@ai-scraper/infrastructure-mongodb');
          const learned = await getLearnedProfile(url);
          return learned.profile
            ? {
                domain: learned.profile.domain,
                isJavaScriptHeavy: learned.shouldUseBrowser,
                selectors: learned.recommendedSelectors,
                stats: {
                  totalJobs: learned.profile.totalJobs,
                  successfulJobs: learned.profile.successfulJobs,
                },
              }
            : null;
        } catch {
          return null;
        }
      },
    };

    this.useCases = createSessionUseCases({
      sessions,
      jobs: jobGateway,
      radiography: { run: runRadiography },
      profileReader,
      credentials: { isEnabled: hasCredentialsKey, encrypt: encryptJson },
      urlPolicy: jobUrlPolicy(),
      radiographyConcurrency: Math.max(1, Number(process.env.RADIOGRAPHY_CONCURRENCY ?? 2)),
      radiographyTimeoutMs: Number(process.env.RADIOGRAPHY_TIMEOUT_MS ?? 120000),
    });
  }

  async create(dto: CreateSessionDto, scope = 'anon') {
    try {
      return await this.useCases.create.execute({
        url: dto.url,
        credentials: dto.credentials,
        scope,
      });
    } catch (error) {
      throw this.toHttpError(error);
    }
  }

  list(scope = 'anon') {
    return this.useCases.queries.list(scope);
  }

  get(id: string, scope = 'anon') {
    return this.useCases.queries.get(id, scope);
  }

  status(id: string, scope = 'anon') {
    return this.useCases.queries.status(id, scope);
  }

  async sendMessage(id: string, dto: SendMessageDto, scope = 'anon') {
    try {
      return await this.useCases.sendMessage.execute({
        sessionId: id,
        instruction: dto.instruction,
        scope,
      });
    } catch (error) {
      throw this.toHttpError(error);
    }
  }

  private toHttpError(error: unknown): unknown {
    if (error instanceof SessionNotReadyError) return new ConflictException(error.message);
    if (error instanceof JobUrlRejectedError || error instanceof SessionCredentialsUnavailableError) {
      return new BadRequestException(error.message);
    }
    return error;
  }
}
