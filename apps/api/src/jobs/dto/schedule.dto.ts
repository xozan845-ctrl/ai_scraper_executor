import { IsUrl, IsString, MinLength, IsOptional, IsObject, IsInt, Min, Max, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { JobAiDto, JobLimitsDto, RenderOptionsDto } from './create-job.dto';

/** POST /api/v1/schedules — job recurrente por intervalo fijo. */
export class CreateScheduleDto {
  @ApiProperty({ example: 'https://www.sevasaonline.com/' })
  @IsUrl({ require_protocol: true })
  url!: string;

  @ApiProperty({ example: 'Obtén todos los productos', minLength: 3 })
  @IsString()
  @MinLength(3)
  instruction!: string;

  @ApiProperty({ example: 3600, minimum: 10, description: 'Intervalo entre ejecuciones (segundos)' })
  @IsInt()
  @Min(10)
  @Max(30 * 24 * 60 * 60)
  intervalSec!: number;

  @ApiPropertyOptional({ description: 'Número máximo de ejecuciones; al alcanzarlo queda COMPLETED', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxRuns?: number;

  @ApiPropertyOptional({ type: JobLimitsDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => JobLimitsDto)
  limits?: JobLimitsDto;

  @ApiPropertyOptional({ type: JobAiDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => JobAiDto)
  ai?: JobAiDto;

  @ApiPropertyOptional({ example: 'https://example.com/hooks/scraping' })
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  webhookUrl?: string;

  @ApiPropertyOptional({ type: RenderOptionsDto, description: 'Render con navegador para SPAs' })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RenderOptionsDto)
  render?: RenderOptionsDto;
}
