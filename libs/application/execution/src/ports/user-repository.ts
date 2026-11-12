export type UserRole = 'superadmin' | 'user';

export interface CreatedUserRecord {
  email: string;
  role: UserRole;
  createdAt: Date;
}

export interface CreateUserData {
  email: string;
  passwordHash: string;
  role: UserRole;
  apiKeyHash: string | null;
}

export interface CreateFirstUserData {
  email: string;
  passwordHash: string;
  apiKeyHash: string;
}

/** Puerto de usuarios; la implementación (Prisma/memoria) vive en infraestructura. */
export interface UserRepository {
  countUsers(): Promise<number>;
  createUser(data: CreateUserData): Promise<CreatedUserRecord>;
  createFirstUser(data: CreateFirstUserData): Promise<CreatedUserRecord>;
  findByEmail(email: string): Promise<{ email: string; role: UserRole } | null>;
  existsApiKeyHash(hash: string): Promise<boolean>;
  findByApiKeyHash(hash: string): Promise<{ userId: string; email: string; role: UserRole } | null>;
  recordLogin(email: string): Promise<void>;
}
