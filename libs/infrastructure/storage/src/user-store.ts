import { randomUUID } from 'node:crypto';
import { getPrismaClient } from './factory';
import type { CreateUserRecord, UserRecord, UserRole, UserStore } from '@ai-scraper/application-execution';

function duplicateBootstrapError(): Error & { code: string } {
  return Object.assign(new Error('Ya existe un usuario; el registro inicial está cerrado.'), { code: 'P2002' });
}

export class PrismaUserStore implements UserStore {
  private readonly prisma = getPrismaClient();

  async countUsers(): Promise<number> { return this.prisma.user.count(); }

  async createUser(data: CreateUserRecord): Promise<UserRecord> {
    const created = await this.prisma.user.create({ data: {
      email: data.email,
      passwordHash: data.passwordHash,
      role: data.role,
      apiKeyHash: data.apiKeyHash,
    } });
    return { email: created.email, role: created.role as UserRole, createdAt: created.createdAt };
  }

  async createFirstUser(data: { email: string; passwordHash: string; apiKeyHash: string }): Promise<UserRecord> {
    if (await this.prisma.user.count() > 0) throw duplicateBootstrapError();
    const created = await this.prisma.user.create({ data: {
      email: data.email,
      passwordHash: data.passwordHash,
      role: 'superadmin',
      apiKeyHash: data.apiKeyHash,
      bootstrap: true,
    } });
    return { email: created.email, role: 'superadmin', createdAt: created.createdAt };
  }

  async findByEmail(email: string): Promise<Pick<UserRecord, 'email' | 'role'> | null> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    return user ? { email: user.email, role: user.role as UserRole } : null;
  }

  async verifyApiKeyHash(hash: string): Promise<boolean> {
    return Boolean(await this.prisma.user.findUnique({ where: { apiKeyHash: hash }, select: { id: true } }));
  }

  async recordLogin(email: string): Promise<void> {
    await this.prisma.user.update({ where: { email }, data: { lastLoginAt: new Date() } }).catch(() => undefined);
  }
}

export class InMemoryUserStore implements UserStore {
  private readonly users = new Map<string, {
    id: string; email: string; passwordHash: string; role: UserRole; apiKeyHash: string | null; createdAt: Date;
  }>();

  async countUsers(): Promise<number> { return this.users.size; }

  async createUser(data: CreateUserRecord): Promise<UserRecord> {
    const user = { id: randomUUID(), ...data, createdAt: new Date() };
    this.users.set(user.id, user);
    return { email: user.email, role: user.role, createdAt: user.createdAt };
  }

  async createFirstUser(data: { email: string; passwordHash: string; apiKeyHash: string }): Promise<UserRecord> {
    if (this.users.size > 0) throw duplicateBootstrapError();
    return this.createUser({ ...data, role: 'superadmin' });
  }

  async findByEmail(email: string): Promise<Pick<UserRecord, 'email' | 'role'> | null> {
    const user = [...this.users.values()].find((item) => item.email === email);
    return user ? { email: user.email, role: user.role } : null;
  }

  async verifyApiKeyHash(hash: string): Promise<boolean> {
    return [...this.users.values()].some((user) => user.apiKeyHash === hash);
  }

  async recordLogin(email: string): Promise<void> { void email; }
}

export function createUserStore(): UserStore {
  if (process.env.DATABASE_URL) return new PrismaUserStore();
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_IN_MEMORY_FALLBACK !== '1') {
    throw new Error('DATABASE_URL requerido para usuarios en producción');
  }
  console.warn('[USER_STORE] DATABASE_URL ausente — usando InMemoryUserStore');
  return memoryUserStore;
}

const memoryUserStore = new InMemoryUserStore();
