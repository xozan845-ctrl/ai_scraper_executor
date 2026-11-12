import type { SessionMessageRecord, SessionRecord } from '../../dtos/session';
import type { SessionStore } from '../../ports/session-store';
import type { SessionJobGateway, SiteProfileReader } from '../../ports/session-integrations';
import { toSessionView, type SessionView } from './session-view';

export type EnrichedSessionMessage = SessionMessageRecord & {
  jobStatus?: string | null;
  results?: unknown[] | null;
};

export interface SessionDetailView extends SessionView {
  messages: EnrichedSessionMessage[];
  profile: Record<string, unknown> | null;
}

export interface SessionStatusView {
  id: string;
  status: string;
  error: string | null;
}

export interface SessionQueriesDeps {
  sessions: SessionStore;
  jobs: SessionJobGateway;
  profileReader: SiteProfileReader;
  staleAfterMs?: number;
}

/** Consultas de sesiones; reconcilia radiografías colgadas y enriquece el historial. */
export class SessionQueries {
  constructor(private readonly deps: SessionQueriesDeps) {}

  async list(scope = 'anon'): Promise<SessionView[]> {
    const rows = await this.deps.sessions.listSessions(100, scope);
    return Promise.all(rows.map(async (session) => toSessionView(await this.reconcileStale(session))));
  }

  async get(id: string, scope = 'anon'): Promise<SessionDetailView | null> {
    const found = await this.deps.sessions.getSession(id, scope);
    if (!found) return null;
    const session = await this.reconcileStale(found);
    const messages = await this.deps.sessions.getMessages(id);
    const enriched = await Promise.all(messages.map((message) => this.enrichMessage(message, scope)));
    const profile = await this.readProfile(session.url);
    return { ...toSessionView(session), messages: enriched, profile };
  }

  async status(id: string, scope = 'anon'): Promise<SessionStatusView | null> {
    const found = await this.deps.sessions.getSession(id, scope);
    if (!found) return null;
    const session = await this.reconcileStale(found);
    return { id: session.id, status: session.status, error: session.error ?? null };
  }

  private async enrichMessage(message: SessionMessageRecord, scope: string): Promise<EnrichedSessionMessage> {
    if (message.role !== 'assistant' || !message.jobId) return message;
    const job = await this.deps.jobs.getJob(message.jobId, scope).catch(() => null);
    const results = job ? await this.deps.jobs.getResults(message.jobId, scope).catch(() => null) : null;
    return { ...message, jobStatus: job?.status ?? null, results: results?.items ?? null };
  }

  private async readProfile(url: string): Promise<Record<string, unknown> | null> {
    try {
      const profile = await this.deps.profileReader.getSummary(url);
      return profile ? { ...profile } : null;
    } catch {
      return null;
    }
  }

  /** Si la radiografía quedó colgada (p. ej. reinicio de API), la marca FAILED. */
  private async reconcileStale(session: SessionRecord): Promise<SessionRecord> {
    const maxAgeMs = this.deps.staleAfterMs ?? 5 * 60 * 1000;
    if (session.status === 'RADIOGRAPHY' && Date.now() - new Date(session.updatedAt).getTime() > maxAgeMs) {
      const updated = await this.deps.sessions.updateSessionStatus(
        session.id,
        'FAILED',
        'Radiografía no completada (timeout)',
      );
      return updated ?? session;
    }
    return session;
  }
}
