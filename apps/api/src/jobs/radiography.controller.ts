import { Controller, Post, Get, Body, Param, Query, NotFoundException, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard';
import { CreateRateLimitGuard } from './rate-limit.guard';
import { mongoRepo, normalizeDomain } from '@ai-scraper/mongodb';

/** Radiografía y memoria de sitios (FASE 12) */
@UseGuards(ApiKeyGuard)
@Controller('radiography')
export class RadiographyController {
  @UseGuards(CreateRateLimitGuard)
  @Post()
  async create(@Body() dto: { url: string; maxDepth?: number; maxPages?: number; forceBrowser?: boolean }) {
    const { performRadiography } = await import('../../../worker/src/radiography');
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
    const { getLearnedProfile } = await import('../../../worker/src/radiography');
    return getLearnedProfile(`https://${domain}`);
  }

  @Get('page/:url(*)')
  async getPageRadiography(@Param('url') url: string, @Query('maxAgeHours') maxAgeHours?: string) {
    const radiography = await mongoRepo.findFreshRadiography(url, maxAgeHours ? Number(maxAgeHours) : 24);
    if (!radiography) throw new NotFoundException(`Radiografía no encontrada o expirada para ${url}`);
    return radiography;
  }

  @Get('domain/:domain/stats')
  async getDomainStats(@Param('domain') domain: string) {
    return mongoRepo.getDomainStats(domain);
  }
}