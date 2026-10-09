import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { getPrismaClient } from '@ai-scraper/infrastructure-storage';
import { generateApiKey } from './password.util';

export type UserRole = 'superadmin' | 'user';

export interface CreatedUser {
  email: string;
  role: UserRole;
  createdAt: Date;
}

interface MemoryUser {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  apiKeyHash: string | null;
  createdAt: Date;
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** Usuarios y claves API. PostgreSQL es la fuente única en producción. */
@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);
  private readonly memory = new Map<string, MemoryUser>();
  private readonly prisma = getPrismaClient();

  private useMemory(): boolean {
    return !process.env.DATABASE_URL && process.env.NODE_ENV !== 'production';
  }

  private ensureReady(): void {
    if (!this.useMemory() && !process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL requerido para usuarios en producción');
    }
  }

  async countUsers(): Promise<number> {
    this.ensureReady();
    return this.useMemory() ? this.memory.size : this.prisma.user.count();
  }

  async createUser(data: {
    email: string;
    passwordHash: string;
    role: UserRole;
    apiKeyHash: string | null;
  }): Promise<CreatedUser> {
    this.ensureReady();
    const email = data.email.trim().toLowerCase();
    if (this.useMemory()) {
      const user: MemoryUser = {
        id: randomUUID(), email, passwordHash: data.passwordHash,
        role: data.role, apiKeyHash: data.apiKeyHash, createdAt: new Date(),
      };
      this.memory.set(user.id, user);
      return { email: user.email, role: user.role, createdAt: user.createdAt };
    }
    const created = await this.prisma.user.create({ data: {
      email, passwordHash: data.passwordHash, role: data.role, apiKeyHash: data.apiKeyHash,
    } });
    return { email: created.email, role: created.role as UserRole, createdAt: created.createdAt };
  }

  async createFirstUser(data: {
    email: string;
    passwordHash: string;
    apiKeyHash: string;
  }): Promise<CreatedUser> {
    this.ensureReady();
    const email = data.email.trim().toLowerCase();
    if (this.useMemory()) {
      if (this.memory.size > 0) throw new ConflictException('Ya existe un usuario; el registro inicial está cerrado.');
      const user: MemoryUser = {
        id: randomUUID(), email, passwordHash: data.passwordHash,
        role: 'superadmin', apiKeyHash: data.apiKeyHash, createdAt: new Date(),
      };
      this.memory.set(user.id, user);
      return { email: user.email, role: user.role, createdAt: user.createdAt };
    }
    if ((await this.prisma.user.count()) > 0) {
      throw new ConflictException('Ya existe un usuario; el registro inicial está cerrado.');
    }
    try {
      const created = await this.prisma.user.create({ data: {
        email, passwordHash: data.passwordHash, role: 'superadmin',
        apiKeyHash: data.apiKeyHash, bootstrap: true,
      } });
      return { email: created.email, role: 'superadmin', createdAt: created.createdAt };
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('Ya existe un usuario; el registro inicial está cerrado.');
      }
      throw error;
    }
  }

  async findByEmail(email: string): Promise<{ email: string; role: UserRole } | null> {
    this.ensureReady();
    const normalized = email.trim().toLowerCase();
    if (this.useMemory()) {
      const found = [...this.memory.values()].find((user) => user.email === normalized);
      return found ? { email: found.email, role: found.role } : null;
    }
    const user = await this.prisma.user.findUnique({ where: { email: normalized } });
    return user ? { email: user.email, role: user.role as UserRole } : null;
  }

  async verifyApiKey(presented: string): Promise<boolean> {
    if (!presented) return false;
    this.ensureReady();
    const hash = hashApiKey(presented);
    if (this.useMemory()) return [...this.memory.values()].some((user) => user.apiKeyHash === hash);
    return Boolean(await this.prisma.user.findUnique({ where: { apiKeyHash: hash }, select: { id: true } }));
  }

  generateApiKey(): string {
    return generateApiKey();
  }

  async recordLogin(email: string): Promise<void> {
    this.logger.debug(`User login recorded: ${email}`);
    this.ensureReady();
    if (this.useMemory()) return;
    await this.prisma.user.update({
      where: { email: email.trim().toLowerCase() }, data: { lastLoginAt: new Date() },
    }).catch(() => undefined);
  }
}
