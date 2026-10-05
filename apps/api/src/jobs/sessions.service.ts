import { Injectable, Inject, BadRequestException, ConflictException, Optional } from '@nestjs/common';
import type { SessionStore, SessionRecord } from '@ai-scraper/storage';
import { encryptJson, hasCredentialsKey, normalizeDomain } from '@ai-scraper/security';
import { SESSION_STORE, RADIOGRAPHER, type Radiographer } from './providers';
import { JobsService, assertJobUrlAllowed } from './jobs.service';
import { CreateSessionDto, SendMessageDto } from './dto/session.dto';

/**
 * Sesiones tipo "chat": una URL + credenciales + historial.
 * Al crear, lanza la radiografía en background; el input del chat se habilita
 * cuando el estado pasa a READY.
 */
@Injectable()
export class SessionsService {
  constructor(
    @Inject(SESSION_STORE) private readonly sessions: SessionStore,
    private readonly jobs: JobsService,
    @Optional() @Inject(RADIOGRAPHER) private readonly radiographer?: Radiographer,
  ) {}

  /** Vista pública: nunca expone credenciales. */
  private view(s: SessionRecord) {
    return {
      id: s.id,
      url: s.url,
      domain: s.domain,
      status: s.status,
      error: s.error ?? null,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  }

  async create(dto: CreateSessionDto) {
    assertJobUrlAllowed(dto.url);
    let credentials: string | null = null;
    if (dto.credentials?.headers && Object.keys(dto.credentials.headers).length > 0) {
      if (!hasCredentialsKey()) {
        throw new BadRequestException('CREDENTIALS_KEY no configurada: no se pueden guardar credenciales');
      }
      credentials = encryptJson({ headers: dto.credentials.headers });
    }
    const session = await this.sessions.createSession({
      url: dto.url,
      domain: normalizeDomain(dto.url),
      credentials,
    });
    // Radiografía en background (el cliente hace polling de /status).
    void this.runRadiography(session.id, dto.url);
    return this.view(session);
  }

  private async runRadiography(sessionId: string, url: string): Promise<void> {
    try {
      if (this.radiographer) {
        await this.radiographer(url);
      } else {
        const { performRadiography } = await import('@ai-scraper/mongodb');
        await performRadiography(url, { maxDepth: 2, maxPages: 10, forceBrowser: true });
      }
      await this.sessions.updateSessionStatus(sessionId, 'READY');
    } catch (e) {
      await this.sessions.updateSessionStatus(sessionId, 'FAILED', (e as Error).message);
    }
  }

  async list() {
    const rows = await this.sessions.listSessions(100);
    return rows.map((s) => this.view(s));
  }

  async get(id: string) {
    const s = await this.sessions.getSession(id);
    if (!s) return null;
    const messages = await this.sessions.getMessages(id);
    let profile: Record<string, unknown> | null;
    try {
      const { getLearnedProfile } = await import('@ai-scraper/mongodb');
      const learned = await getLearnedProfile(s.url);
      profile = learned.profile
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
      profile = null;
    }
    return { ...this.view(s), messages, profile };
  }

  async status(id: string) {
    const s = await this.sessions.getSession(id);
    if (!s) return null;
    return { id: s.id, status: s.status, error: s.error ?? null };
  }

  async sendMessage(id: string, dto: SendMessageDto) {
    const s = await this.sessions.getSession(id);
    if (!s) return null;
    if (s.status !== 'READY') {
      throw new ConflictException('La sesión no está lista (radiografía en curso o fallida)');
    }
    await this.sessions.addMessage(id, 'user', dto.instruction);
    const job = await this.jobs.create({ url: s.url, instruction: dto.instruction });
    const assistant = await this.sessions.addMessage(id, 'assistant', 'Analizando la página…', job.id);
    return { message: assistant, jobId: job.id, jobStatus: job.status };
  }
}
