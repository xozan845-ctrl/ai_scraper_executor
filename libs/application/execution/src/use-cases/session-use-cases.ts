import type { SessionStore } from '../ports/session-store';
import type { SessionRecord } from '../dtos/session';

export interface SessionJobActions {
  create(input: { url: string; instruction: string }, key?: string, sessionId?: string, scope?: string): Promise<{ id: string; status: string }>;
  findOne(id: string, scope?: string): Promise<{ status?: string } | null>;
  results(id: string, scope?: string): Promise<{ items?: unknown[] } | null>;
}

export interface CreateSessionCommand {
  url: string;
  credentials?: { headers?: Record<string, string> };
}

export interface SessionUseCaseOptions {
  validateUrl: (url: string) => void;
  hasCredentialsKey: () => boolean;
  encryptCredentials: (value: unknown) => string;
  normalizeDomain: (url: string) => string;
  radiographer: (url: string, headers?: Record<string, string>) => Promise<void>;
  learnedProfile: (url: string) => Promise<Record<string, unknown> | null>;
  radiographyConcurrency?: number;
  radiographyTimeoutMs?: number;
}

export class CredentialsKeyMissingError extends Error {}
export class SessionNotReadyError extends Error {}

export class SessionUseCases {
  private activeRadiographies = 0;
  private radiographyQueue: Array<() => void> = [];

  constructor(
    private readonly sessions: SessionStore,
    private readonly jobs: SessionJobActions,
    private readonly options: SessionUseCaseOptions,
  ) {}

  private view(session: SessionRecord) {
    return {
      id: session.id,
      url: session.url,
      domain: session.domain,
      status: session.status,
      error: session.error ?? null,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  async create(command: CreateSessionCommand, scope = 'anon') {
    this.options.validateUrl(command.url);
    let credentials: string | null = null;
    const headers = command.credentials?.headers;
    if (headers && Object.keys(headers).length > 0) {
      if (!this.options.hasCredentialsKey()) {
        throw new CredentialsKeyMissingError('CREDENTIALS_KEY no configurada: no se pueden guardar credenciales');
      }
      credentials = this.options.encryptCredentials({ headers });
    }
    const session = await this.sessions.createSession({
      url: command.url,
      domain: this.options.normalizeDomain(command.url),
      credentials,
      ownerScope: scope,
    });
    void this.runRadiography(session.id, command.url, headers);
    return this.view(session);
  }

  private async acquireSlot(): Promise<void> {
    const concurrency = this.options.radiographyConcurrency ?? 2;
    if (this.activeRadiographies < concurrency) {
      this.activeRadiographies += 1;
      return;
    }
    return new Promise((resolve) => this.radiographyQueue.push(resolve));
  }

  private releaseSlot(): void {
    const next = this.radiographyQueue.shift();
    if (next) next();
    else this.activeRadiographies -= 1;
  }

  private async runRadiography(id: string, url: string, headers?: Record<string, string>): Promise<void> {
    await this.acquireSlot();
    try {
      const timeoutMs = this.options.radiographyTimeoutMs ?? 120_000;
      await this.withTimeout(this.options.radiographer(url, headers), timeoutMs, `Radiografía no completada en ${timeoutMs}ms`);
      await this.sessions.updateSessionStatus(id, 'READY');
    } catch (error) {
      await this.sessions.updateSessionStatus(id, 'FAILED', (error as Error).message);
    } finally {
      this.releaseSlot();
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    if (!Number.isFinite(ms) || ms <= 0) return promise;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), ms);
      promise.then(
        (value) => { clearTimeout(timer); resolve(value); },
        (error) => { clearTimeout(timer); reject(error); },
      );
    });
  }

  async list(scope = 'anon') {
    const rows = await this.sessions.listSessions(100, scope);
    return Promise.all(rows.map(async (session) => this.view(await this.reconcileStale(session))));
  }

  private async reconcileStale(session: SessionRecord, maxAgeMs = 5 * 60 * 1000): Promise<SessionRecord> {
    if (session.status === 'RADIOGRAPHY' && Date.now() - new Date(session.updatedAt).getTime() > maxAgeMs) {
      return await this.sessions.updateSessionStatus(session.id, 'FAILED', 'Radiografía no completada (timeout)') ?? session;
    }
    return session;
  }

  async get(id: string, scope = 'anon') {
    const found = await this.sessions.getSession(id, scope);
    if (!found) return null;
    const session = await this.reconcileStale(found);
    const messages = await this.sessions.getMessages(id);
    const enriched = await Promise.all(messages.map(async (message) => {
      if (message.role !== 'assistant' || !message.jobId) return message;
      const job = await this.jobs.findOne(message.jobId, scope).catch(() => null);
      const results = job ? await this.jobs.results(message.jobId, scope).catch(() => null) : null;
      return { ...message, jobStatus: job?.status ?? null, results: results?.items ?? null };
    }));
    const profile = await this.options.learnedProfile(session.url).catch(() => null);
    return { ...this.view(session), messages: enriched, profile };
  }

  async status(id: string, scope = 'anon') {
    const found = await this.sessions.getSession(id, scope);
    if (!found) return null;
    const session = await this.reconcileStale(found);
    return { id: session.id, status: session.status, error: session.error ?? null };
  }

  async sendMessage(id: string, instruction: string, scope = 'anon') {
    const session = await this.sessions.getSession(id, scope);
    if (!session) return null;
    if (session.status !== 'READY') throw new SessionNotReadyError('La sesión no está lista (radiografía en curso o fallida)');
    await this.sessions.addMessage(id, 'user', instruction);
    const job = await this.jobs.create({ url: session.url, instruction }, undefined, session.id, scope);
    const message = await this.sessions.addMessage(id, 'assistant', 'Analizando la página…', job.id);
    return { message, jobId: job.id, jobStatus: job.status };
  }
}
