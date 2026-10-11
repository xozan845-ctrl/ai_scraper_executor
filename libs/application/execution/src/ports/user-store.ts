export type UserRole = 'superadmin' | 'user';

export interface UserRecord {
  email: string;
  role: UserRole;
  createdAt: Date;
}

export interface CreateUserRecord {
  email: string;
  passwordHash: string;
  role: UserRole;
  apiKeyHash: string | null;
}

export interface UserStore {
  countUsers(): Promise<number>;
  createUser(data: CreateUserRecord): Promise<UserRecord>;
  createFirstUser(data: { email: string; passwordHash: string; apiKeyHash: string }): Promise<UserRecord>;
  findByEmail(email: string): Promise<Pick<UserRecord, 'email' | 'role'> | null>;
  verifyApiKeyHash(hash: string): Promise<boolean>;
  recordLogin(email: string): Promise<void>;
}
