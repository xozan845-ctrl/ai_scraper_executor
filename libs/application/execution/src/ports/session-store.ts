import type { CreateSessionInput, SessionMessageRecord, SessionRecord } from '../dtos/session';

export interface SessionStore {
  readonly kind: 'prisma' | 'memory';
  createSession(input: CreateSessionInput): Promise<SessionRecord>;
  getSession(id: string, ownerScope?: string): Promise<SessionRecord | null>;
  listSessions(limit?: number, ownerScope?: string): Promise<SessionRecord[]>;
  updateSessionStatus(id: string, status: string, error?: string | null): Promise<SessionRecord | null>;
  addMessage(sessionId: string, role: string, content: string, jobId?: string | null): Promise<SessionMessageRecord>;
  getMessages(sessionId: string): Promise<SessionMessageRecord[]>;
}
