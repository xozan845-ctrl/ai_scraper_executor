import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const now = () => new Date().toISOString();
const nid = (p: string) => `${p}_${randomUUID().slice(0, 8)}`;

export interface SessionRecord {
  id: string;
  url: string;
  domain: string;
  status: string; // RADIOGRAPHY | READY | FAILED
  credentials?: string | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionMessageRecord {
  id: string;
  sessionId: string;
  role: string; // user | assistant
  content: string;
  jobId?: string | null;
  createdAt: string;
}

export interface CreateSessionInput {
  url: string;
  domain: string;
  credentials?: string | null;
}

/** Persistencia de sesiones tipo "chat" (una URL + contexto + historial). */
export interface SessionStore {
  readonly kind: 'prisma' | 'memory';
  createSession(input: CreateSessionInput): Promise<SessionRecord>;
  getSession(id: string): Promise<SessionRecord | null>;
  listSessions(limit?: number): Promise<SessionRecord[]>;
  updateSessionStatus(id: string, status: string, error?: string | null): Promise<SessionRecord | null>;
  addMessage(sessionId: string, role: string, content: string, jobId?: string | null): Promise<SessionMessageRecord>;
  getMessages(sessionId: string): Promise<SessionMessageRecord[]>;
}

/** Store en memoria (tests/dev sin Postgres). */
export class InMemorySessionStore implements SessionStore {
  readonly kind = 'memory' as const;
  private sessions = new Map<string, SessionRecord>();
  private order: string[] = [];
  private messages = new Map<string, SessionMessageRecord[]>();

  async createSession(input: CreateSessionInput): Promise<SessionRecord> {
    const rec: SessionRecord = {
      id: nid('sess'),
      url: input.url,
      domain: input.domain,
      status: 'RADIOGRAPHY',
      credentials: input.credentials ?? null,
      error: null,
      createdAt: now(),
      updatedAt: now(),
    };
    this.sessions.set(rec.id, rec);
    this.order.push(rec.id);
    return { ...rec };
  }
  async getSession(id: string): Promise<SessionRecord | null> {
    return this.sessions.get(id) ?? null;
  }
  async listSessions(limit = 50): Promise<SessionRecord[]> {
    return [...this.order].reverse().slice(0, limit).map((id) => ({ ...(this.sessions.get(id) as SessionRecord) }));
  }
  async updateSessionStatus(id: string, status: string, error?: string | null): Promise<SessionRecord | null> {
    const s = this.sessions.get(id);
    if (!s) return null;
    s.status = status;
    s.error = error ?? null;
    s.updatedAt = now();
    return { ...s };
  }
  async addMessage(sessionId: string, role: string, content: string, jobId?: string | null): Promise<SessionMessageRecord> {
    const list = this.messages.get(sessionId) ?? [];
    const rec: SessionMessageRecord = { id: nid('msg'), sessionId, role, content, jobId: jobId ?? null, createdAt: now() };
    list.push(rec);
    this.messages.set(sessionId, list);
    return { ...rec };
  }
  async getMessages(sessionId: string): Promise<SessionMessageRecord[]> {
    return [...(this.messages.get(sessionId) ?? [])];
  }
}

const toRecord = (s: {
  id: string; url: string; domain: string; status: string;
  credentials: string | null; error: string | null; createdAt: Date; updatedAt: Date;
}): SessionRecord => ({
  id: s.id, url: s.url, domain: s.domain, status: s.status,
  credentials: s.credentials, error: s.error,
  createdAt: s.createdAt.toISOString(), updatedAt: s.updatedAt.toISOString(),
});

/** Store PostgreSQL vía Prisma. */
export class PrismaSessionStore implements SessionStore {
  readonly kind = 'prisma' as const;
  constructor(private readonly prisma: PrismaClient) {}

  async createSession(input: CreateSessionInput): Promise<SessionRecord> {
    const s = await this.prisma.session.create({
      data: { url: input.url, domain: input.domain, status: 'RADIOGRAPHY', credentials: input.credentials ?? null },
    });
    return toRecord(s);
  }
  async getSession(id: string): Promise<SessionRecord | null> {
    const s = await this.prisma.session.findUnique({ where: { id } });
    return s ? toRecord(s) : null;
  }
  async listSessions(limit = 50): Promise<SessionRecord[]> {
    const rows = await this.prisma.session.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
    return rows.map(toRecord);
  }
  async updateSessionStatus(id: string, status: string, error?: string | null): Promise<SessionRecord | null> {
    try {
      const s = await this.prisma.session.update({ where: { id }, data: { status, error: error ?? null } });
      return toRecord(s);
    } catch {
      return null;
    }
  }
  async addMessage(sessionId: string, role: string, content: string, jobId?: string | null): Promise<SessionMessageRecord> {
    const m = await this.prisma.sessionMessage.create({ data: { sessionId, role, content, jobId: jobId ?? null } });
    return { id: m.id, sessionId: m.sessionId, role: m.role, content: m.content, jobId: m.jobId, createdAt: m.createdAt.toISOString() };
  }
  async getMessages(sessionId: string): Promise<SessionMessageRecord[]> {
    const rows = await this.prisma.sessionMessage.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } });
    return rows.map((m) => ({ id: m.id, sessionId: m.sessionId, role: m.role, content: m.content, jobId: m.jobId, createdAt: m.createdAt.toISOString() }));
  }
}

let sessionSingleton: SessionStore | null = null;
let prismaClient: PrismaClient | null = null;

function getClient(): PrismaClient {
  if (!prismaClient) prismaClient = new PrismaClient();
  return prismaClient;
}

async function canConnect(client: PrismaClient, timeoutMs = 3000): Promise<boolean> {
  try {
    await Promise.race([
      client.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error('db timeout')), timeoutMs)),
    ]);
    return true;
  } catch {
    return false;
  }
}

/** Prisma si DATABASE_URL responde, si no memoria (avisado). */
export async function createSessionStore(): Promise<SessionStore> {
  if (sessionSingleton) return sessionSingleton;
  if (process.env.DATABASE_URL) {
    const client = getClient();
    if (await canConnect(client)) {
      sessionSingleton = new PrismaSessionStore(client);
      console.log('[STORAGE] SessionStore PostgreSQL (Prisma)');
      return sessionSingleton;
    }
    console.warn('[STORAGE] SessionStore: DATABASE_URL no responde — memoria');
  } else {
    console.warn('[STORAGE] SessionStore: sin DATABASE_URL — memoria');
  }
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_IN_MEMORY_FALLBACK !== '1') {
    throw new Error('PostgreSQL no disponible en producción; SessionStore en memoria deshabilitado');
  }
  sessionSingleton = new InMemorySessionStore();
  return sessionSingleton;
}

export function __resetSessionStoreSingleton(): void {
  sessionSingleton = null;
}
