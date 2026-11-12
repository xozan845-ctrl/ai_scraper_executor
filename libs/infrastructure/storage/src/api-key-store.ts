import crypto from 'node:crypto';
import type {
  ApiKeyRecord,
  ApiKeyRepository,
  ApiKeyRole,
  AuthenticatedApiKey,
  CreateApiKeyInput,
} from '@ai-scraper/application-execution';
import { getPrismaClient } from './factory';

function toRecord(key: {
  id: string;
  name: string;
  prefix: string;
  role: string;
  createdBy: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}): ApiKeyRecord {
  return {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    role: key.role as ApiKeyRole,
    createdBy: key.createdBy ?? undefined,
    createdAt: key.createdAt.toISOString(),
    lastUsedAt: key.lastUsedAt?.toISOString(),
    revokedAt: key.revokedAt?.toISOString(),
  };
}

class MemoryApiKeyRepository implements ApiKeyRepository {
  private readonly keys = new Map<string, ApiKeyRecord & { keyHash: string }>();

  async create(input: CreateApiKeyInput): Promise<ApiKeyRecord> {
    const record = {
      id: `key_${crypto.randomUUID()}`,
      name: input.name,
      keyHash: input.keyHash,
      prefix: input.prefix,
      role: input.role,
      createdBy: input.createdBy,
      createdAt: new Date().toISOString(),
    };
    this.keys.set(record.id, record);
    const { keyHash: _keyHash, ...view } = record;
    return { ...view };
  }

  async list(): Promise<ApiKeyRecord[]> {
    return [...this.keys.values()]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map(({ keyHash: _keyHash, ...record }) => ({ ...record }));
  }

  async revoke(id: string): Promise<boolean> {
    const key = this.keys.get(id);
    if (!key || key.revokedAt) return false;
    this.keys.set(id, { ...key, revokedAt: new Date().toISOString() });
    return true;
  }

  async findByHash(hash: string): Promise<AuthenticatedApiKey | null> {
    const key = [...this.keys.values()].find((row) => row.keyHash === hash);
    if (!key || key.revokedAt) return null;
    return { id: key.id, role: key.role, name: key.name };
  }

  async touch(id: string): Promise<void> {
    const key = this.keys.get(id);
    if (key) this.keys.set(id, { ...key, lastUsedAt: new Date().toISOString() });
  }
}

class PrismaApiKeyRepository implements ApiKeyRepository {
  private readonly prisma = getPrismaClient();

  async create(input: CreateApiKeyInput): Promise<ApiKeyRecord> {
    const created = await this.prisma.apiKey.create({ data: input });
    return toRecord(created);
  }

  async list(): Promise<ApiKeyRecord[]> {
    const rows = await this.prisma.apiKey.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map(toRecord);
  }

  async revoke(id: string): Promise<boolean> {
    const result = await this.prisma.apiKey.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count > 0;
  }

  async findByHash(hash: string): Promise<AuthenticatedApiKey | null> {
    const key = await this.prisma.apiKey.findUnique({ where: { keyHash: hash } });
    if (!key || key.revokedAt) return null;
    return { id: key.id, role: key.role as ApiKeyRole, name: key.name };
  }

  async touch(id: string): Promise<void> {
    await this.prisma.apiKey.update({ where: { id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  }
}

export function createApiKeyRepository(): ApiKeyRepository {
  if (!process.env.DATABASE_URL) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('DATABASE_URL requerido para API keys en producción');
    }
    return new MemoryApiKeyRepository();
  }
  return new PrismaApiKeyRepository();
}
