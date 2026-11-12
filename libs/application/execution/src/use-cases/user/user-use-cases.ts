import type {
  CreateFirstUserData,
  CreateUserData,
  CreatedUserRecord,
  UserRepository,
  UserRole,
} from '../../ports/user-repository';
import { generateApiKey, hashApiKey } from './api-key';

export interface UserUseCaseDeps {
  repository: UserRepository;
}

/** Casos de uso de usuarios y API keys; no conoce Prisma ni Nest. */
export class UserUseCases {
  constructor(private readonly deps: UserUseCaseDeps) {}

  countUsers(): Promise<number> {
    return this.deps.repository.countUsers();
  }

  createUser(data: CreateUserData): Promise<CreatedUserRecord> {
    return this.deps.repository.createUser({ ...data, email: data.email.trim().toLowerCase() });
  }

  createFirstUser(data: CreateFirstUserData): Promise<CreatedUserRecord> {
    return this.deps.repository.createFirstUser({ ...data, email: data.email.trim().toLowerCase() });
  }

  findByEmail(email: string): Promise<{ email: string; role: UserRole } | null> {
    return this.deps.repository.findByEmail(email.trim().toLowerCase());
  }

  async verifyApiKey(presented: string): Promise<boolean> {
    if (!presented) return false;
    return this.deps.repository.existsApiKeyHash(hashApiKey(presented));
  }

  async authenticateApiKey(presented: string): Promise<{ userId: string; email: string; role: UserRole } | null> {
    if (!presented) return null;
    return this.deps.repository.findByApiKeyHash(hashApiKey(presented));
  }

  generateApiKey(): string {
    return generateApiKey();
  }

  recordLogin(email: string): Promise<void> {
    return this.deps.repository.recordLogin(email.trim().toLowerCase());
  }
}

export function createUserUseCases(deps: UserUseCaseDeps): UserUseCases {
  return new UserUseCases(deps);
}
