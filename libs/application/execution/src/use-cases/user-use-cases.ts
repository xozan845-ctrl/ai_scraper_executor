import { createHash } from 'node:crypto';
import type { UserRecord, UserRole, UserStore } from '../ports/user-store';

export class FirstUserAlreadyExistsError extends Error {}

export class UserUseCases {
  constructor(private readonly store: UserStore) {}

  countUsers(): Promise<number> { return this.store.countUsers(); }

  createUser(data: { email: string; passwordHash: string; role: UserRole; apiKeyHash: string | null }): Promise<UserRecord> {
    return this.store.createUser({ ...data, email: data.email.trim().toLowerCase() });
  }

  async createFirstUser(data: { email: string; passwordHash: string; apiKeyHash: string }): Promise<UserRecord> {
    try {
      return await this.store.createFirstUser({ ...data, email: data.email.trim().toLowerCase() });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002' || error instanceof FirstUserAlreadyExistsError) {
        throw new FirstUserAlreadyExistsError('Ya existe un usuario; el registro inicial está cerrado.');
      }
      throw error;
    }
  }

  async registerFirst(
    data: { email: string; password: string },
    adapters: {
      hashPassword: (password: string) => Promise<string>;
      generateApiKey: () => string;
      hashApiKey: (apiKey: string) => string;
    },
  ): Promise<{ user: UserRecord; apiKey: string }> {
    const passwordHash = await adapters.hashPassword(data.password);
    const apiKey = adapters.generateApiKey();
    const user = await this.createFirstUser({
      email: data.email,
      passwordHash,
      apiKeyHash: adapters.hashApiKey(apiKey),
    });
    return { user, apiKey };
  }

  findByEmail(email: string) { return this.store.findByEmail(email.trim().toLowerCase()); }

  verifyApiKey(presented: string): Promise<boolean> {
    if (!presented) return Promise.resolve(false);
    return this.store.verifyApiKeyHash(createHash('sha256').update(presented).digest('hex'));
  }

  recordLogin(email: string): Promise<void> { return this.store.recordLogin(email.trim().toLowerCase()); }
}
