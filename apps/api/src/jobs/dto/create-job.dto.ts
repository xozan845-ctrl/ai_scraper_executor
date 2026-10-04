import { IsUrl, IsString, MinLength, IsOptional, IsObject, IsInt, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** POST /api/v1/jobs §42 */
export class CreateJobDto {
  @ApiProperty({ example: 'https://www.sevasaonline.com/', description: 'URL inicial (http/https)' })
  @IsUrl({ require_protocol: true })
  url!: string;

  @ApiProperty({ example: 'Obtén todos los productos con nombre, precio e imagen', minLength: 3 })
  @IsString()
  @MinLength(3)
  instruction!: string;

  @ApiPropertyOptional({
    description: 'Límites del job (§35)',
    example: { maxPages: 5, maxDepth: 2, maxItems: 50, maxRuntimeSec: 300, maxAiTokens: 200000 },
  })
  @IsOptional()
  @IsObject()
  limits?: {
    maxPages?: number;
    maxDepth?: number;
    maxItems?: number;
    maxRuntimeSec?: number;
    maxRequests?: number;
    maxAiTokens?: number;
  };

  @ApiPropertyOptional({ description: 'Proveedor/modelo IA', example: { provider: 'openrouter', model: 'openrouter/free' } })
  @IsOptional()
  @IsObject()
  ai?: { provider?: 'openrouter' | 'custom'; model?: string };

  @ApiPropertyOptional({ description: 'FASE 11: 1 = máxima, 10 = mínima, 5 = defecto', minimum: 1, maximum: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  priority?: number;
}
