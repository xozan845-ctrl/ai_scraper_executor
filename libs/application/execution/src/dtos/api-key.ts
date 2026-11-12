export type ApiKeyRole = 'superadmin' | 'user';

export interface CreateApiKeyInput {
  name: string;
  keyHash: string;
  prefix: string;
  role: ApiKeyRole;
  createdBy?: string;
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  role: ApiKeyRole;
  createdBy?: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

export interface AuthenticatedApiKey {
  id: string;
  role: ApiKeyRole;
  name: string;
}
