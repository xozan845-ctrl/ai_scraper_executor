import { SiteProfile, PageRadiography, ISiteProfile, IPageRadiography, DiscoveredSelector } from './models';
import { connectMongo, isMongoMock } from './connection';
import { normalizeDomain as normalizeDomainBase } from '@ai-scraper/shared-security';
import mongoose from 'mongoose';

export { hashHtml } from '@ai-scraper/shared-core';

/** Normaliza dominio para claves de perfil: minúsculas, sin www., sin esquema/path/puerto. */
export function normalizeDomain(raw: string): string {
  return normalizeDomainBase(raw, { stripWww: true });
}

/** Fallback en memoria para tests sin MongoDB */
interface ProfileWithId extends ISiteProfile { _id: mongoose.Types.ObjectId }
interface RadiographyWithId extends IPageRadiography { _id: mongoose.Types.ObjectId }

class MemoryFallback {
  private profiles = new Map<string, ProfileWithId>();
  private radiographies = new Map<string, RadiographyWithId>();

  private genId() { return new mongoose.Types.ObjectId(); }

  async getOrCreateProfile(domain: string, baseUrl: string): Promise<ProfileWithId> {
    const norm = normalizeDomain(domain);
    const p = this.profiles.get(norm);
    if (!p) {
      const newProfile = {
        _id: this.genId(),
        domain: norm,
        baseUrl,
        listSelectors: [],
        detailSelectors: [],
        navigationSelectors: [],
        pagination: null,
        totalJobs: 0,
        successfulJobs: 0,
        failedJobs: 0,
        avgItemsPerJob: 0,
        avgDurationMs: 0,
        isJavaScriptHeavy: false,
        recommendedLimits: {},
        language: undefined,
        currency: undefined,
        robotsTxt: undefined,
        sitemapUrls: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        recordJobSuccess: async () => {},
        recordJobFailure: async () => {},
        upsertSelector: () => {},
      } as unknown as ProfileWithId;
      this.profiles.set(norm, newProfile);
      return newProfile;
    }
    return p;
  }

  async findProfile(domain: string): Promise<ProfileWithId | null> {
    return this.profiles.get(normalizeDomain(domain)) ?? null;
  }

  async updateSelectors(profileId: string, updates: {
    listSelectors?: DiscoveredSelector[];
    detailSelectors?: DiscoveredSelector[];
    navigationSelectors?: DiscoveredSelector[];
    pagination?: ProfileWithId['pagination'];
    isJavaScriptHeavy?: boolean;
    recommendedLimits?: ProfileWithId['recommendedLimits'];
  }): Promise<ProfileWithId | null> {
    for (const p of this.profiles.values()) {
      if (p._id.toString() === profileId) {
        if (updates.listSelectors) updates.listSelectors.forEach((s: DiscoveredSelector) => this.upsertSelector(p.listSelectors, s));
        if (updates.detailSelectors) updates.detailSelectors.forEach((s: DiscoveredSelector) => this.upsertSelector(p.detailSelectors, s));
        if (updates.navigationSelectors) updates.navigationSelectors.forEach((s: DiscoveredSelector) => this.upsertSelector(p.navigationSelectors, s));
        if (updates.pagination) p.pagination = updates.pagination;
        if (updates.isJavaScriptHeavy !== undefined) p.isJavaScriptHeavy = updates.isJavaScriptHeavy;
        if (updates.recommendedLimits) p.recommendedLimits = { ...p.recommendedLimits, ...updates.recommendedLimits };
        return p;
      }
    }
    return null;
  }

  private upsertSelector(list: DiscoveredSelector[], sel: DiscoveredSelector) {
    const existing = list.find((s) => s.selector === sel.selector);
    if (existing) {
      existing.confidence = Math.min(1, existing.confidence + 0.1);
      existing.timesUsed += 1;
      existing.lastUsedAt = new Date();
      existing.successRate = Math.min(1, existing.successRate + 0.05);
      if (sel.pageUrls) existing.pageUrls.push(...sel.pageUrls.filter((u) => !existing.pageUrls.includes(u)));
    } else {
      list.push({ ...sel, confidence: sel.confidence ?? 0.5, timesUsed: 1, lastUsedAt: new Date(), successRate: 0.5 });
    }
  }

  async recordJobResult(profileId: string, success: boolean, items: number, durationMs: number) {
    for (const p of this.profiles.values()) {
      if (p._id.toString() === profileId) {
        p.totalJobs += 1;
        if (success) {
          p.successfulJobs += 1;
          p.avgItemsPerJob = (p.avgItemsPerJob * (p.totalJobs - 1) + items) / p.totalJobs;
          p.avgDurationMs = (p.avgDurationMs * (p.totalJobs - 1) + durationMs) / p.totalJobs;
        } else {
          p.failedJobs += 1;
        }
        return;
      }
    }
  }

  async saveRadiography(data: { url: string; expiresAt?: Date; [key: string]: unknown }): Promise<RadiographyWithId> {
    const key = data.url;
    const rad = { _id: this.genId(), ...data, fetchedAt: new Date(), expiresAt: data.expiresAt } as unknown as RadiographyWithId;
    this.radiographies.set(key, rad);
    return rad;
  }

  async findFreshRadiography(url: string, maxAgeHours = 24): Promise<RadiographyWithId | null> {
    const cutoff = new Date(Date.now() - maxAgeHours * 3600 * 1000);
    for (const r of this.radiographies.values()) {
      if (r.url === url && r.fetchedAt >= cutoff) return r;
    }
    return null;
  }

  async findRadiographiesByDomain(domain: string, limit = 50): Promise<RadiographyWithId[]> {
    const norm = normalizeDomain(domain);
    const results: RadiographyWithId[] = [];
    for (const r of this.radiographies.values()) {
      if (r.domain === norm) results.push(r);
    }
    return results.sort((a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime()).slice(0, limit);
  }

  async getDomainStats(domain: string) {
    const profile = await this.findProfile(domain);
    const radios = await this.findRadiographiesByDomain(domain, 100);
    const avgLoadTime = radios.length ? radios.reduce((a, r) => a + r.loadTimeMs, 0) / radios.length : 0;
    const browserUsageRate = radios.length ? radios.filter((r) => r.usedBrowser).length / radios.length : 0;
    return { profile, recentRadiographies: radios.length, avgLoadTime, browserUsageRate };
  }
}

let memoryFallback: MemoryFallback | null = null;

function getFallback(): MemoryFallback {
  if (!memoryFallback) memoryFallback = new MemoryFallback();
  return memoryFallback;
}

export class MongoRepository {
  private ready = false;
  private useFallback = false;

  async ensureReady(): Promise<void> {
    if (!this.ready) {
      try {
        await connectMongo();
        this.useFallback = isMongoMock();
      } catch {
        this.useFallback = true;
      }
      this.ready = true;
    }
  }

  private getStore() {
    return this.useFallback ? getFallback() : null;
  }

  /** Obtiene o crea el perfil del sitio */
  async getOrCreateProfile(domain: string, baseUrl: string): Promise<ISiteProfile> {
    await this.ensureReady();
    const store = this.getStore();
    if (store) return store.getOrCreateProfile(domain, baseUrl);
    const norm = normalizeDomain(domain);
    let profile = await SiteProfile.findOne({ domain: norm });
    if (!profile) {
      profile = await SiteProfile.create({ domain: norm, baseUrl, listSelectors: [], detailSelectors: [], navigationSelectors: [] });
    }
    return profile;
  }

  /** Busca perfil por dominio */
  async findProfile(domain: string): Promise<ISiteProfile | null> {
    await this.ensureReady();
    const store = this.getStore();
    if (store) return store.findProfile(domain);
    return SiteProfile.findOne({ domain: normalizeDomain(domain) });
  }

  /** Actualiza selectores descubiertos en el perfil */
  async updateSelectors(profileId: string, updates: {
    listSelectors?: DiscoveredSelector[];
    detailSelectors?: DiscoveredSelector[];
    navigationSelectors?: DiscoveredSelector[];
    pagination?: ISiteProfile['pagination'];
    isJavaScriptHeavy?: boolean;
    recommendedLimits?: ISiteProfile['recommendedLimits'];
  }): Promise<ISiteProfile | null> {
    await this.ensureReady();
    const store = this.getStore();
    if (store) return store.updateSelectors(profileId, updates);
    const profile = await SiteProfile.findById(profileId);
    if (!profile) return null;
    if (updates.listSelectors) updates.listSelectors.forEach((s) => profile.upsertSelector(profile.listSelectors, s));
    if (updates.detailSelectors) updates.detailSelectors.forEach((s) => profile.upsertSelector(profile.detailSelectors, s));
    if (updates.navigationSelectors) updates.navigationSelectors.forEach((s) => profile.upsertSelector(profile.navigationSelectors, s));
    if (updates.pagination) profile.pagination = updates.pagination;
    if (updates.isJavaScriptHeavy !== undefined) profile.isJavaScriptHeavy = updates.isJavaScriptHeavy;
    if (updates.recommendedLimits) profile.recommendedLimits = { ...profile.recommendedLimits, ...updates.recommendedLimits };
    await profile.save();
    return profile;
  }

  /** Registra métricas de job */
  async recordJobResult(profileId: string, success: boolean, items: number, durationMs: number): Promise<void> {
    await this.ensureReady();
    const store = this.getStore();
    if (store) return store.recordJobResult(profileId, success, items, durationMs);
    const profile = await SiteProfile.findById(profileId);
    if (profile) {
      if (success) await profile.recordJobSuccess(items, durationMs);
      else await profile.recordJobFailure();
    }
  }

  /** Guarda radiografía de página (usa el hash real del HTML provisto por el crawler). */
  async saveRadiography(data: {
    url: string;
    profileId: string;
    htmlHash: string;
    title: string;
    structure: IPageRadiography['structure'];
    extractedData?: unknown;
    statusCode: number;
    loadTimeMs: number;
    usedBrowser: boolean;
    ttlHours?: number;
  }): Promise<IPageRadiography> {
    await this.ensureReady();
    const store = this.getStore();
    if (store) return store.saveRadiography(data);
    const domain = normalizeDomain(data.url);
    const htmlHash = data.htmlHash;
    const existing = await PageRadiography.findOne({ url: data.url, htmlHash });
    if (existing) {
      existing.fetchedAt = new Date();
      existing.expiresAt = new Date(Date.now() + (data.ttlHours ?? 24) * 3600 * 1000);
      await existing.save();
      return existing;
    }
    return PageRadiography.create({
      url: data.url,
      domain,
      profileId: data.profileId,
      htmlHash,
      title: data.title,
      structure: data.structure,
      extractedData: data.extractedData,
      statusCode: data.statusCode,
      loadTimeMs: data.loadTimeMs,
      usedBrowser: data.usedBrowser,
      expiresAt: new Date(Date.now() + (data.ttlHours ?? 24) * 3600 * 1000),
    });
  }

  /** Busca radiografía fresca (no expirada) */
  async findFreshRadiography(url: string, maxAgeHours = 24): Promise<IPageRadiography | null> {
    await this.ensureReady();
    const store = this.getStore();
    if (store) return store.findFreshRadiography(url, maxAgeHours);
    const cutoff = new Date(Date.now() - maxAgeHours * 3600 * 1000);
    return PageRadiography.findOne({ url, fetchedAt: { $gte: cutoff } }).sort({ fetchedAt: -1 });
  }

  /** Busca radiografías por dominio para análisis */
  async findRadiographiesByDomain(domain: string, limit = 50): Promise<IPageRadiography[]> {
    await this.ensureReady();
    const store = this.getStore();
    if (store) return store.findRadiographiesByDomain(domain, limit);
    return PageRadiography.find({ domain: normalizeDomain(domain) }).sort({ fetchedAt: -1 }).limit(limit);
  }

  /** Obtiene stats agregadas del dominio */
  async getDomainStats(domain: string): Promise<{
    profile: ISiteProfile | null;
    recentRadiographies: number;
    avgLoadTime: number;
    browserUsageRate: number;
  }> {
    await this.ensureReady();
    const store = this.getStore();
    if (store) return store.getDomainStats(domain);
    const profile = await this.findProfile(domain);
    const radios = await this.findRadiographiesByDomain(domain, 100);
    const avgLoadTime = radios.length ? radios.reduce((a, r) => a + r.loadTimeMs, 0) / radios.length : 0;
    const browserUsageRate = radios.length ? radios.filter((r) => r.usedBrowser).length / radios.length : 0;
    return { profile, recentRadiographies: radios.length, avgLoadTime, browserUsageRate };
  }
}

export const mongoRepo = new MongoRepository();