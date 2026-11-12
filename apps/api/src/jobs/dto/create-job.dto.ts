import { IsUrl, IsString, MinLength, IsOptional, IsObject, IsInt, IsIn, Min, Max, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HARD_LIMITS } from '@ai-scraper/domain-execution';
import type { OutputSchema } from '@ai-scraper/domain-scraper';

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

/** Render con navegador para SPAs (Angular/React/Vue/…). */
export class RenderOptionsDto {
  @ApiPropertyOptional({ enum: ['auto', 'always', 'never'], description: 'auto = heurística del motor' })
  @IsOptional()
  @IsIn(['auto', 'always', 'never'])
  mode?: 'auto' | 'always' | 'never';

  @ApiPropertyOptional({ enum: ['domcontentloaded', 'load', 'networkidle'] })
  @IsOptional()
  @IsIn(['domcontentloaded', 'load', 'networkidle'])
  waitUntil?: 'domcontentloaded' | 'load' | 'networkidle';

  @ApiPropertyOptional({ example: 'app-root', description: 'Selector que debe existir antes de capturar' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  waitForSelector?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 10000, description: 'Espera mínima extra (ms)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  waitMs?: number;

  @ApiPropertyOptional({ minimum: 1000, maximum: 60000, description: 'Timeout de render (ms)' })
  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(60000)
  timeoutMs?: number;
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

  @ApiPropertyOptional({
    description: 'URL que recibirá un POST firmado cuando el job termine',
    example: 'https://example.com/hooks/scraping',
  })
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  webhookUrl?: string;

  @ApiPropertyOptional({ type: RenderOptionsDto, description: 'Render con navegador para SPAs' })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RenderOptionsDto)
  render?: RenderOptionsDto;

  @ApiPropertyOptional({
    description: 'Esquema de salida por campo: { strict, fields: { campo: { type, required, pattern, min, max, enum } } }',
    type: 'object', additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  outputSchema?: OutputSchema;

  @ApiPropertyOptional({ description: 'FASE 11: 1 = máxima, 10 = mínima, 5 = defecto', minimum: 1, maximum: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  priority?: number;
}
