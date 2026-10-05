import { Schema, model, models, Document, Types } from 'mongoose';

/** Selector descubierto con metadata de confianza y uso */
export interface DiscoveredSelector {
  selector: string;
  type: 'product' | 'list' | 'pagination' | 'detail' | 'navigation' | 'other';
  confidence: number;           // 0-1, qué tan fiable es
  sampleText?: string;          // texto de ejemplo
  attributes?: string[];        // attrs útiles (href, src, etc.)
  pageUrls: string[];           // URLs donde se encontró
  timesUsed: number;            // cuántas veces el scraper lo usó con éxito
  lastUsedAt?: Date;
  successRate: number;          // 0-1, éxito histórico
}

/** Patrón de paginación detectado */
export interface PaginationPattern {
  type: 'query' | 'path' | 'next-link' | 'infinite-scroll';
  pattern?: string;             // ej: "?page={n}", "/page/{n}"
  selector?: string;            // si es next-link
  maxPagesDetected?: number;
  confidence: number;
}

/** Perfil de usuario del sistema */
export interface IUser extends Document {
  email: string;
  passwordHash: string;
  role: 'superadmin' | 'user';
  /** SHA-256 de la API key (nunca se guarda en claro). */
  apiKeyHash?: string;
  createdAt: Date;
  lastLoginAt?: Date;
}

/** Tipo de documento de usuario para TypeScript */
export type UserDocument = IUser;

/** Modelo de usuario de MongoDB */
export const User = model<IUser>('User', new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['superadmin', 'user'], default: 'user' },
    apiKeyHash: { type: String, index: true, sparse: true },
  },
  { timestamps: true }
));

/** Perfil de un sitio/dominio aprendido con el tiempo */
export interface ISiteProfile extends Document {
  domain: string;               // clave única: "tienda.com"
  baseUrl: string;              // URL semilla original
  createdAt: Date;
  updatedAt: Date;

  // Estructura descubierta
  listSelectors: DiscoveredSelector[];      // selectores de listas (.product-card, etc.)
  detailSelectors: DiscoveredSelector[];    // selectores de ficha de producto
  pagination: PaginationPattern | null;
  navigationSelectors: DiscoveredSelector[]; // menús, categorías, filtros

  // Métricas de uso
  totalJobs: number;
  successfulJobs: number;
  failedJobs: number;
  avgItemsPerJob: number;
  avgDurationMs: number;

  // Configuración aprendida (override de defaults)
  recommendedLimits?: {
    maxPages?: number;
    maxDepth?: number;
    maxItems?: number;
    needsBrowser?: boolean;
  };

  // Metadatos
  language?: string;
  currency?: string;
  isJavaScriptHeavy: boolean;
  robotsTxt?: string;
  sitemapUrls?: string[];

  // Métodos
  recordJobSuccess(items: number, durationMs: number): Promise<void>;
  recordJobFailure(): Promise<void>;
  upsertSelector(list: DiscoveredSelector[], sel: DiscoveredSelector): void;
}

const DiscoveredSelectorSchema = new Schema<DiscoveredSelector>({
  selector: { type: String, required: true },
  type: { type: String, enum: ['product', 'list', 'pagination', 'detail', 'navigation', 'other'], required: true },
  confidence: { type: Number, default: 0.5, min: 0, max: 1 },
  sampleText: String,
  attributes: [String],
  pageUrls: [String],
  timesUsed: { type: Number, default: 0 },
  lastUsedAt: Date,
  successRate: { type: Number, default: 0, min: 0, max: 1 },
}, { _id: false });

const PaginationPatternSchema = new Schema<PaginationPattern>({
  type: { type: String, enum: ['query', 'path', 'next-link', 'infinite-scroll'], required: true },
  pattern: String,
  selector: String,
  maxPagesDetected: Number,
  confidence: { type: Number, default: 0.5, min: 0, max: 1 },
}, { _id: false });

const SiteProfileSchema = new Schema<ISiteProfile>({
  domain: { type: String, required: true, unique: true, index: true },
  baseUrl: { type: String, required: true },
  listSelectors: [DiscoveredSelectorSchema],
  detailSelectors: [DiscoveredSelectorSchema],
  pagination: PaginationPatternSchema,
  navigationSelectors: [DiscoveredSelectorSchema],
  totalJobs: { type: Number, default: 0 },
  successfulJobs: { type: Number, default: 0 },
  failedJobs: { type: Number, default: 0 },
  avgItemsPerJob: { type: Number, default: 0 },
  avgDurationMs: { type: Number, default: 0 },
  recommendedLimits: {
    maxPages: Number,
    maxDepth: Number,
    maxItems: Number,
    needsBrowser: Boolean,
  },
  language: String,
  currency: String,
  isJavaScriptHeavy: { type: Boolean, default: false },
  robotsTxt: String,
  sitemapUrls: [String],
}, { timestamps: true });

SiteProfileSchema.methods.recordJobSuccess = async function (items: number, durationMs: number) {
  this.totalJobs += 1;
  this.successfulJobs += 1;
  this.avgItemsPerJob = (this.avgItemsPerJob * (this.totalJobs - 1) + items) / this.totalJobs;
  this.avgDurationMs = (this.avgDurationMs * (this.totalJobs - 1) + durationMs) / this.totalJobs;
  await this.save();
};

SiteProfileSchema.methods.recordJobFailure = async function () {
  this.totalJobs += 1;
  this.failedJobs += 1;
  await this.save();
};

SiteProfileSchema.methods.upsertSelector = function (list: DiscoveredSelector[], sel: DiscoveredSelector) {
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
};

export const SiteProfile = models.SiteProfile || model<ISiteProfile>('SiteProfile', SiteProfileSchema);

/** Radiografía de una página concreta (cache detallado) */
export interface IPageRadiography extends Document {
  url: string;                  // URL canónica normalizada
  domain: string;               // para queries rápidas
  profileId: Types.ObjectId;    // ref a SiteProfile
  fetchedAt: Date;
  htmlHash: string;             // hash del HTML para detectar cambios
  title: string;
  structure: {
    lists: Array<{ selector: string; count: number; sampleItems: unknown[] }>;
    forms: Array<{ selector: string; fields: string[] }>;
    scripts: number;
    stylesheets: number;
  };
  extractedData?: unknown;      // último EXTRACT_LIST exitoso (para diff)
  statusCode: number;
  loadTimeMs: number;
  usedBrowser: boolean;
  expiresAt: Date;              // TTL automático
}

const PageRadiographySchema = new Schema<IPageRadiography>({
  url: { type: String, required: true, index: true },
  domain: { type: String, required: true, index: true },
  profileId: { type: Schema.Types.ObjectId, ref: 'SiteProfile', required: true },
  fetchedAt: { type: Date, default: Date.now },
  htmlHash: { type: String, required: true },
  title: String,
  structure: {
    lists: [{
      selector: String,
      count: Number,
      sampleItems: Schema.Types.Mixed,
    }],
    forms: [{
      selector: String,
      fields: [String],
    }],
    scripts: Number,
    stylesheets: Number,
  },
  extractedData: Schema.Types.Mixed,
  statusCode: Number,
  loadTimeMs: Number,
  usedBrowser: Boolean,
  expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
});

export const PageRadiography = models.PageRadiography || model<IPageRadiography>('PageRadiography', PageRadiographySchema);