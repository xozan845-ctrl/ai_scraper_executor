import type { ApiKeyRecord, AuthenticatedApiKey, CreateApiKeyInput } from '../dtos/api-key';

export interface ApiKeyRepository {
  create(input: CreateApiKeyInput): Promise<ApiKeyRecord>;
  list(): Promise<ApiKeyRecord[]>;
  revoke(id: string): Promise<boolean>;
  findByHash(hash: string): Promise<AuthenticatedApiKey | null>;
  touch(id: string): Promise<void>;
}
