import { Injectable, Inject, BadRequestException, ConflictException, Optional } from '@nestjs/common';
import type { SessionStore, SessionRecord } from '@ai-scraper/storage';
import { encryptJson, hasCredentialsKey, normalizeDomain } from '@ai-scraper/shared-security';
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

  async create(dto: CreateSessionDto, scope = 'anon') {
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
      ownerScope: scope,
    });
    // Radiografía en background (el cliente hace polling de /status).
    void this.runRadiography(session.id, dto.url, dto.credentials?.headers);
    return this.view(session);
  }

  private readonly radiographyConcurrency = Math.max(1, Number(process.env.RADIOGRAPHY_CONCURRENCY ?? 2));
  private activeRadiographies = 0;
  private radiographyQueue: Array<() => void> = [];

  private acquireSlot(): Promise<void> {
    if (this.activeRadiographies < this.radiographyConcurrency) {
      this.activeRadiographies += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.radiographyQueue.push(resolve));
  }

  private releaseSlot(): void {
    const next = this.radiographyQueue.shift();
    if (next) next(); // el slot se transfiere al siguiente en cola
    else this.activeRadiographies -= 1;
  }

  private async runRadiography(sessionId: string, url: string, headers?: Record<string, string>): Promise<void> {
    await this.acquireSlot();
    try {
      const timeoutMs = Number(process.env.RADIOGRAPHY_TIMEOUT_MS ?? 120000);
      await this.withTimeout(this.performRadiography(url, headers), timeoutMs, `Radiografía no completada en ${timeoutMs}ms`);
      await this.sessions.updateSessionStatus(sessionId, 'READY');
    } catch (e) {
      await this.sessions.updateSessionStatus(sessionId, 'FAILED', (e as Error).message);
    } finally {
      this.releaseSlot();
    }
  }

  private async performRadiography(url: string, headers?: Record<string, string>): Promise<void> {
    if (this.radiographer) {
      await this.radiographer(url, headers);
      return;
    }
    const { performRadiography } = await import('@ai-scraper/mongodb');
    await performRadiography(url, { maxDepth: 2, maxPages: 10, forceBrowser: true, ...(headers ? { headers } : {}) });
  }

  private withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    if (!Number.isFinite(ms) || ms <= 0) return promise;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), ms);
      promise.then(
        (v) => { clearTimeout(timer); resolve(v); },
        (e) => { clearTimeout(timer); reject(e); },
      );
    });
  }

  async list(scope = 'anon') {
    const rows = await this.sessions.listSessions(100, scope);
    return Promise.all(rows.map(async (s) => this.view(await this.reconcileStale(s))));
  }

  /** Si la radiografía quedó colgada (p. ej. reinicio de API), la marca FAILED. */
  private async reconcileStale(s: SessionRecord, maxAgeMs = 5 * 60 * 1000): Promise<SessionRecord> {
    if (s.status === 'RADIOGRAPHY' && Date.now() - new Date(s.updatedAt).getTime() > maxAgeMs) {
      const updated = await this.sessions.updateSessionStatus(s.id, 'FAILED', 'Radiografía no completada (timeout)');
      return updated ?? s;
    }
    return s;
  }

  async get(id: string, scope = 'anon') {
    const found = await this.sessions.getSession(id, scope);
    if (!found) return null;
    const s = await this.reconcileStale(found);
    const messages = await this.sessions.getMessages(id);
    // Enriquece los mensajes del asistente con estado/resultados del job (historial autocontenido).
    const enriched = await Promise.all(
      messages.map(async (m) => {
        if (m.role !== 'assistant' || !m.jobId) return m;
        const job = await this.jobs.findOne(m.jobId, scope).catch(() => null);
        const res = job ? await this.jobs.results(m.jobId, scope).catch(() => null) : null;
        return { ...m, jobStatus: job?.status ?? null, results: res?.items ?? null };
      }),
    );
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
    return { ...this.view(s), messages: enriched, profile };
  }

  async status(id: string, scope = 'anon') {
    const found = await this.sessions.getSession(id, scope);
    if (!found) return null;
    const s = await this.reconcileStale(found);
    return { id: s.id, status: s.status, error: s.error ?? null };
  }

  async sendMessage(id: string, dto: SendMessageDto, scope = 'anon') {
    const s = await this.sessions.getSession(id, scope);
    if (!s) return null;
    if (s.status !== 'READY') {
      throw new ConflictException('La sesión no está lista (radiografía en curso o fallida)');
    }
    await this.sessions.addMessage(id, 'user', dto.instruction);
    const job = await this.jobs.create({ url: s.url, instruction: dto.instruction }, undefined, s.id, scope);
    const assistant = await this.sessions.addMessage(id, 'assistant', 'Analizando la página…', job.id);
    return { message: assistant, jobId: job.id, jobStatus: job.status };
  }
}
