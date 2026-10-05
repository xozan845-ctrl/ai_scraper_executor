import { Controller, Post, Get, Body, Param, Query, NotFoundException, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard';
import { CreateRateLimitGuard } from './rate-limit.guard';
import { mongoRepo, normalizeDomain, performRadiography, getLearnedProfile } from '@ai-scraper/mongodb';

/** Radiografía y memoria de sitios (FASE 12) */
@UseGuards(ApiKeyGuard)
@Controller('radiography')
export class RadiographyController {
  @UseGuards(CreateRateLimitGuard)
  @Post()
  async create(@Body() dto: { url: string; maxDepth?: number; maxPages?: number; forceBrowser?: boolean }) {
    const result = await performRadiography(dto.url, {
      maxDepth: dto.maxDepth,
      maxPages: dto.maxPages,
      forceBrowser: dto.forceBrowser,
    });
    return {
      domain: normalizeDomain(dto.url),
      profileId: result.profile.id,
      discovered: result.discovered,
      radiography: result.radiography,
    };
  }

  @Get('profile/:domain')
  async getProfile(@Param('domain') domain: string) {
    const profile = await mongoRepo.findProfile(domain);
    if (!profile) throw new NotFoundException(`Perfil no encontrado para ${domain}`);
    return profile;
  }

  @Get('profile/:domain/selectors')
  async getSelectors(@Param('domain') domain: string) {
    return getLearnedProfile(`https://${domain}`);
  }

  @Get('page/*url')
  async getPageRadiography(@Param('url') url: string | string[], @Query('maxAgeHours') maxAgeHours?: string) {
    const target = Array.isArray(url) ? url.join('/') : url;
    const radiography = await mongoRepo.findFreshRadiography(target, maxAgeHours ? Number(maxAgeHours) : 24);
    if (!radiography) throw new NotFoundException(`Radiografía no encontrada o expirada para ${target}`);
    return radiography;
  }

  @Get('domain/:domain/stats')
  async getDomainStats(@Param('domain') domain: string) {
    return mongoRepo.getDomainStats(domain);
  }
}