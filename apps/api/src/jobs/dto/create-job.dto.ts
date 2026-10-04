import { IsUrl, IsString, MinLength, IsOptional, IsObject, IsInt, Min, Max } from 'class-validator';

/** POST /api/v1/jobs §42 */
export class CreateJobDto {
  @IsUrl({ require_protocol: true })
  url!: string;

  @IsString()
  @MinLength(3)
  instruction!: string;

  @IsOptional()
  @IsObject()
  limits?: {
    maxPages?: number;
    maxDepth?: number;
    maxItems?: number;
    maxRuntimeSec?: number;
    maxRequests?: number;
  };

  @IsOptional()
  @IsObject()
  ai?: { provider?: 'openrouter' | 'custom'; model?: string };

  /** FASE 11: 1 = máxima, 10 = mínima, 5 = defecto. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  priority?: number;
}
