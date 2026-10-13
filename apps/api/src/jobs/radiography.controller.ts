import { Controller, Post, Get, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard';
import { CreateRateLimitGuard } from './rate-limit.guard';
import { RadiographyService } from './radiography.service';

/** Radiografía y memoria de sitios (FASE 12). Solo orquesta HTTP; la memoria vive en el servicio. */
@UseGuards(ApiKeyGuard)
@Controller('radiography')
export class RadiographyController {
  constructor(private readonly radiography: RadiographyService) {}

  @UseGuards(CreateRateLimitGuard)
  @Post()
  create(@Body() dto: { url: string; maxDepth?: number; maxPages?: number; forceBrowser?: boolean }) {
    return this.radiography.create(dto);
  }

  @Get('profile/:domain')
  getProfile(@Param('domain') domain: string) {
    return this.radiography.getProfile(domain);
  }

  @Get('profile/:domain/selectors')
  getSelectors(@Param('domain') domain: string) {
    return this.radiography.getSelectors(domain);
  }

  @Get('page/*url')
  getPageRadiography(@Param('url') url: string | string[], @Query('maxAgeHours') maxAgeHours?: string) {
    const target = Array.isArray(url) ? url.join('/') : url;
    return this.radiography.getPageRadiography(target, maxAgeHours ? Number(maxAgeHours) : 24);
  }

  @Get('domain/:domain/stats')
  getDomainStats(@Param('domain') domain: string) {
    return this.radiography.getDomainStats(domain);
  }
}
