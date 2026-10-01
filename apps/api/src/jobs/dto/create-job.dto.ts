import { IsUrl, IsString, MinLength, IsOptional, IsObject } from 'class-validator';

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
}
