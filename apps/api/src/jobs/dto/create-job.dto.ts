import { IsUrl, IsString, MinLength, IsOptional, IsObject, IsInt, IsIn, Min, Max, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HARD_LIMITS } from '@ai-scraper/domain-execution';

/**
 * Límites del job §35 con topes duros de servidor (HARD_LIMITS).
 * La validación es estricta y la normalización (normalizeJobLimits) vuelve a
 * recortar en el worker, de modo que ni el cliente ni la IA pueden elevar límites.
 */
export class JobLimitsDto {
  @ApiPropertyOptional({ minimum: 1, maximum: HARD_LIMITS.maxPages, example: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(HARD_LIMITS.maxPages)
  maxPages?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: HARD_LIMITS.maxDepth, example: 2 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(HARD_LIMITS.maxDepth)
  maxDepth?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: HARD_LIMITS.maxItems, example: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(HARD_LIMITS.maxItems)
  maxItems?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: HARD_LIMITS.maxRuntimeSec, example: 300 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(HARD_LIMITS.maxRuntimeSec)
  maxRuntimeSec?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: HARD_LIMITS.maxRequests, example: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(HARD_LIMITS.maxRequests)
  maxRequests?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: HARD_LIMITS.maxAiTokens,
    description: 'Presupuesto de tokens IA (0/vacío = presupuesto por defecto del servidor)',
    example: 200000,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(HARD_LIMITS.maxAiTokens)
  maxAiTokens?: number;
}

/** Selección de proveedor/modelo IA por job §18. */
export class JobAiDto {
  @ApiPropertyOptional({ enum: ['openrouter', 'custom'], example: 'openrouter' })
  @IsOptional()
  @IsString()
  @IsIn(['openrouter', 'custom'])
  provider?: 'openrouter' | 'custom';

  @ApiPropertyOptional({ example: 'openrouter/free' })
  @IsOptional()
  @IsString()
  model?: string;
}

/** POST /api/v1/jobs §42 */
export class CreateJobDto {
  @ApiProperty({ example: 'https://www.sevasaonline.com/', description: 'URL inicial (http/https)' })
  @IsUrl({ require_protocol: true })
  url!: string;

  @ApiProperty({ example: 'Obtén todos los productos con nombre, precio e imagen', minLength: 3 })
  @IsString()
  @MinLength(3)
  instruction!: string;

  @ApiPropertyOptional({ type: JobLimitsDto, description: 'Límites del job (§35)' })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => JobLimitsDto)
  limits?: JobLimitsDto;

  @ApiPropertyOptional({ type: JobAiDto, description: 'Proveedor/modelo IA' })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => JobAiDto)
  ai?: JobAiDto;

  @ApiPropertyOptional({ description: 'FASE 11: 1 = máxima, 10 = mínima, 5 = defecto', minimum: 1, maximum: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  priority?: number;
}
