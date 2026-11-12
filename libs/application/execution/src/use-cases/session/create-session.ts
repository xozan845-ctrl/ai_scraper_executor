import { normalizeDomain } from '@ai-scraper/shared-security';
import type { SessionStore } from '../../ports/session-store';
import type { RadiographyRunner, SessionCredentials } from '../../ports/session-integrations';
import { assertJobUrlAllowed, type JobUrlPolicy } from '../job/job-url-policy';
import { SessionCredentialsUnavailableError } from './errors';
import { toSessionView, type SessionView } from './session-view';

export interface CreateSessionCommand {
  url: string;
  credentials?: { headers?: Record<string, string> };
  scope?: string;
}

export interface CreateSessionDeps {
  sessions: SessionStore;
  radiography: RadiographyRunner;
  credentials: SessionCredentials;
  urlPolicy: JobUrlPolicy;
  radiographyConcurrency?: number;
  radiographyTimeoutMs?: number;
}

/**
 * Crea la sesión (RADIOGRAPHY) y lanza la radiografía en background; el cliente
 * hace polling de `/status` hasta READY.
 */
export class CreateSessionUseCase {
  private readonly concurrency: number;
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly deps: CreateSessionDeps) {
    this.concurrency = Math.max(1, deps.radiographyConcurrency ?? 2);
  }

  async execute(command: CreateSessionCommand): Promise<SessionView> {
    assertJobUrlAllowed(command.url, this.deps.urlPolicy);

    let credentials: string | null = null;
    if (command.credentials?.headers && Object.keys(command.credentials.headers).length > 0) {
      if (!this.deps.credentials.isEnabled()) throw new SessionCredentialsUnavailableError();
      credentials = this.deps.credentials.encrypt({ headers: command.credentials.headers });
    }

    const session = await this.deps.sessions.createSession({
      url: command.url,
      domain: normalizeDomain(command.url),
      credentials,
      ownerScope: command.scope ?? 'anon',
    });
    void this.runRadiography(session.id, command.url, command.credentials?.headers);
    return toSessionView(session);
  }

  private acquireSlot(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.queue.push(resolve));
  }

  private releaseSlot(): void {
    const next = this.queue.shift();
    if (next) next();
    else this.active -= 1;
  }

  private async runRadiography(sessionId: string, url: string, headers?: Record<string, string>): Promise<void> {
    await this.acquireSlot();
    try {
      const timeoutMs = this.deps.radiographyTimeoutMs ?? 120000;
      await this.withTimeout(
        this.deps.radiography.run(url, headers),
        timeoutMs,
        `Radiografía no completada en ${timeoutMs}ms`,
      );
      await this.deps.sessions.updateSessionStatus(sessionId, 'READY');
    } catch (error) {
      await this.deps.sessions.updateSessionStatus(sessionId, 'FAILED', (error as Error).message);
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
}
