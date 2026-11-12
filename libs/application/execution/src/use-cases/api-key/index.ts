import type { ApiKeyRecord, AuthenticatedApiKey } from '../../dtos/api-key';
import type { ApiKeyRepository } from '../../ports/api-key-repository';
import { generateApiKey, hashApiKey } from '../user/api-key';

export class ApiKeyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiKeyValidationError';
  }
}

export interface GenerateApiKeyCommand {
  name: string;
  createdBy?: string;
}

export interface GeneratedApiKey {
  apiKey: string;
  record: ApiKeyRecord;
}

export interface ApiKeyDeps {
  repository: ApiKeyRepository;
}

export class GenerateApiKeyUseCase {
  constructor(private readonly deps: ApiKeyDeps) {}

  async execute(command: GenerateApiKeyCommand): Promise<GeneratedApiKey> {
    const name = command.name.trim();
    if (name.length < 2 || name.length > 80) {
      throw new ApiKeyValidationError('name debe tener entre 2 y 80 caracteres');
    }
    const apiKey = generateApiKey();
    const record = await this.deps.repository.create({
      name,
      keyHash: hashApiKey(apiKey),
      prefix: apiKey.slice(0, 12),
      role: 'user',
      ...(command.createdBy ? { createdBy: command.createdBy } : {}),
    });
    return { apiKey, record };
  }
}

export class ListApiKeysUseCase {
  constructor(private readonly deps: ApiKeyDeps) {}

  execute(): Promise<ApiKeyRecord[]> {
    return this.deps.repository.list();
  }
}

export class RevokeApiKeyUseCase {
  constructor(private readonly deps: ApiKeyDeps) {}

  execute(id: string): Promise<boolean> {
    return this.deps.repository.revoke(id);
  }
}

export class AuthenticateApiKeyUseCase {
  constructor(private readonly deps: ApiKeyDeps) {}

  async execute(presented: string): Promise<AuthenticatedApiKey | null> {
    if (!presented) return null;
    const found = await this.deps.repository.findByHash(hashApiKey(presented));
    if (!found) return null;
    void this.deps.repository.touch(found.id).catch(() => undefined);
    return found;
  }
}

export interface ApiKeyUseCases {
  generate: GenerateApiKeyUseCase;
  list: ListApiKeysUseCase;
  revoke: RevokeApiKeyUseCase;
  authenticate: AuthenticateApiKeyUseCase;
}

export function createApiKeyUseCases(deps: ApiKeyDeps): ApiKeyUseCases {
  return {
    generate: new GenerateApiKeyUseCase(deps),
    list: new ListApiKeysUseCase(deps),
    revoke: new RevokeApiKeyUseCase(deps),
    authenticate: new AuthenticateApiKeyUseCase(deps),
  };
}
