import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { User, connectMongo, isMongoMock } from '@ai-scraper/mongodb';
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

/** SHA-256 de la API key: en BD solo se guarda el hash, nunca la clave en claro. */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Usuarios del sistema (registro inicial + verificación de API keys de BD).
 * Reutiliza el modelo `User` de @ai-scraper/mongodb (sin @nestjs/mongoose ni
 * segunda conexión) y cae a memoria bajo MONGODB_MOCK=1, igual que el resto.
 */
@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);
  private readonly memory = new Map<string, MemoryUser>();

  private async ensureReady(): Promise<void> {
    await connectMongo();
  }

  async countUsers(): Promise<number> {
    await this.ensureReady();
    if (isMongoMock()) return this.memory.size;
    return User.countDocuments({});
  }

  async createUser(data: {
    email: string;
    passwordHash: string;
    role: UserRole;
    apiKeyHash: string | null;
  }): Promise<CreatedUser> {
    await this.ensureReady();
    const email = data.email.trim().toLowerCase();
    if (isMongoMock()) {
      const u: MemoryUser = {
        id: randomUUID(),
        email,
        passwordHash: data.passwordHash,
        role: data.role,
        apiKeyHash: data.apiKeyHash,
        createdAt: new Date(),
      };
      this.memory.set(u.id, u);
      return { email: u.email, role: u.role, createdAt: u.createdAt };
    }
    const created = await User.create({
      email,
      passwordHash: data.passwordHash,
      role: data.role,
      apiKeyHash: data.apiKeyHash ?? undefined,
    });
    return {
      email: created.email,
      role: (created.role as UserRole) ?? 'user',
      createdAt: created.createdAt ?? new Date(),
    };
  }

  async findByEmail(email: string): Promise<{ email: string; role: UserRole } | null> {
    await this.ensureReady();
    const normalized = email.trim().toLowerCase();
    if (isMongoMock()) {
      const found = [...this.memory.values()].find((u) => u.email === normalized);
      return found ? { email: found.email, role: found.role } : null;
    }
    const user = await User.findOne({ email: normalized });
    return user ? { email: user.email, role: (user.role as UserRole) ?? 'user' } : null;
  }

  /** true si la API key presentada corresponde a un usuario registrado (hash). */
  async verifyApiKey(presented: string): Promise<boolean> {
    if (!presented) return false;
    await this.ensureReady();
    const hash = hashApiKey(presented);
    if (isMongoMock()) return [...this.memory.values()].some((u) => u.apiKeyHash === hash);
    const found = await User.findOne({ apiKeyHash: hash }).select({ _id: 1 }).lean();
    return Boolean(found);
  }

  generateApiKey(): string {
    return generateApiKey();
  }

  async recordLogin(email: string): Promise<void> {
    this.logger.debug(`User login recorded: ${email}`);
    if (isMongoMock()) return;
    await this.ensureReady();
    await User.updateOne({ email: email.trim().toLowerCase() }, { lastLoginAt: new Date() }).catch(() => undefined);
  }
}
