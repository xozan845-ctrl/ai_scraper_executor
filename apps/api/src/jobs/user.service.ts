import { ConflictException, Inject, Injectable } from '@nestjs/common';
import {
  createUserUseCases,
  hashApiKey,
  UserAlreadyExistsError,
  type CreateFirstUserData,
  type CreateUserData,
  type CreatedUserRecord,
  type UserRepository,
  type UserRole,
  type UserUseCases,
} from '@ai-scraper/application-execution';
import { USER_REPOSITORY } from './providers';

export { hashApiKey };
export type { UserRole };
export type CreatedUser = CreatedUserRecord;

/** Adaptador Nest de los casos de uso de usuarios; Prisma/memoria viven en infraestructura. */
@Injectable()
export class UserService {
  private readonly useCases: UserUseCases;

  constructor(@Inject(USER_REPOSITORY) repository: UserRepository) {
    this.useCases = createUserUseCases({ repository });
  }

  countUsers(): Promise<number> {
    return this.useCases.countUsers();
  }

  createUser(data: CreateUserData): Promise<CreatedUserRecord> {
    return this.useCases.createUser(data);
  }

  async createFirstUser(data: CreateFirstUserData): Promise<CreatedUserRecord> {
    try {
      return await this.useCases.createFirstUser(data);
    } catch (error) {
      if (error instanceof UserAlreadyExistsError) throw new ConflictException(error.message);
      throw error;
    }
  }

  findByEmail(email: string): Promise<{ email: string; role: UserRole } | null> {
    return this.useCases.findByEmail(email);
  }

  verifyApiKey(presented: string): Promise<boolean> {
    return this.useCases.verifyApiKey(presented);
  }

  generateApiKey(): string {
    return this.useCases.generateApiKey();
  }

  recordLogin(email: string): Promise<void> {
    return this.useCases.recordLogin(email);
  }
}
