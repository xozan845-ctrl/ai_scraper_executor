import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ApiKeyValidationError, type ApiKeyUseCases } from '@ai-scraper/application-execution';
import { API_KEY_USE_CASES } from './providers';
import { CreateApiKeyDto } from './dto/api-key.dto';

/** Adaptador Nest de la administración de API keys de cliente. */
@Injectable()
export class ApiKeysService {
  constructor(@Inject(API_KEY_USE_CASES) private readonly useCases: ApiKeyUseCases) {}

  async create(dto: CreateApiKeyDto, createdBy?: string) {
    try {
      const generated = await this.useCases.generate.execute({
        name: dto.name,
        ...(createdBy ? { createdBy } : {}),
      });
      return {
        ...generated.record,
        apiKey: generated.apiKey,
        note: 'Guarde la API key mostrada; no se volverá a mostrar.',
      };
    } catch (error) {
      if (error instanceof ApiKeyValidationError) throw new BadRequestException(error.message);
      throw error;
    }
  }

  list() {
    return this.useCases.list.execute();
  }

  revoke(id: string) {
    return this.useCases.revoke.execute(id);
  }
}
