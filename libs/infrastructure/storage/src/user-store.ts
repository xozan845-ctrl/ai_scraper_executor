import crypto from 'node:crypto';
import {
  UserAlreadyExistsError,
  type CreateFirstUserData,
  type CreateUserData,
  type CreatedUserRecord,
  type UserRepository,
  type UserRole,
} from '@ai-scraper/application-execution';
import { getPrismaClient } from './factory';

interface MemoryUser {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  apiKeyHash: string | null;
  createdAt: Date;
}

class MemoryUserRepository implements UserRepository {
  private readonly users = new Map<string, MemoryUser>();

  async countUsers(): Promise<number> {
    return this.users.size;
  }

  async createUser(data: CreateUserData): Promise<CreatedUserRecord> {
    return this.save({ ...data, role: data.role });
  }

  async createFirstUser(data: CreateFirstUserData): Promise<CreatedUserRecord> {
    if (this.users.size > 0) throw new UserAlreadyExistsError();
    return this.save({ ...data, role: 'superadmin' });
  }

  async findByEmail(email: string): Promise<{ email: string; role: UserRole } | null> {
    const found = [...this.users.values()].find((user) => user.email === email);
    return found ? { email: found.email, role: found.role } : null;
  }

  async existsApiKeyHash(hash: string): Promise<boolean> {
    return [...this.users.values()].some((user) => user.apiKeyHash === hash);
  }

  async recordLogin(): Promise<void> {}

  private save(data: CreateUserData): CreatedUserRecord {
    const user: MemoryUser = { id: crypto.randomUUID(), createdAt: new Date(), ...data };
    this.users.set(user.id, user);
    return { email: user.email, role: user.role, createdAt: user.createdAt };
  }
}

class PrismaUserRepository implements UserRepository {
  private readonly prisma = getPrismaClient();

  async countUsers(): Promise<number> {
    return this.prisma.user.count();
  }

  async createUser(data: CreateUserData): Promise<CreatedUserRecord> {
    const created = await this.prisma.user.create({ data });
    return this.toCreated(created);
  }

  async createFirstUser(data: CreateFirstUserData): Promise<CreatedUserRecord> {
    if ((await this.prisma.user.count()) > 0) throw new UserAlreadyExistsError();
    try {
      const created = await this.prisma.user.create({
        data: { ...data, role: 'superadmin', bootstrap: true },
      });
      return this.toCreated(created);
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new UserAlreadyExistsError();
      throw error;
    }
  }

  async findByEmail(email: string): Promise<{ email: string; role: UserRole } | null> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    return user ? { email: user.email, role: user.role as UserRole } : null;
  }

  async existsApiKeyHash(hash: string): Promise<boolean> {
    return Boolean(await this.prisma.user.findUnique({ where: { apiKeyHash: hash }, select: { id: true } }));
  }

  async recordLogin(email: string): Promise<void> {
    await this.prisma.user.update({
      where: { email },
      data: { lastLoginAt: new Date() },
    }).catch(() => undefined);
  }

  private toCreated(user: { email: string; role: string; createdAt: Date }): CreatedUserRecord {
    return { email: user.email, role: user.role as UserRole, createdAt: user.createdAt };
  }
}

/** Prisma si hay DATABASE_URL; memoria en dev/test; fail-fast en producción sin BD. */
export function createUserRepository(): UserRepository {
  if (!process.env.DATABASE_URL) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('DATABASE_URL requerido para usuarios en producción');
    }
    return new MemoryUserRepository();
  }
  return new PrismaUserRepository();
}
