/** Ejecuta la radiografía del sitio; el adaptador concreto vive en el borde. */
export interface RadiographyRunner {
  run(url: string, headers?: Record<string, string>): Promise<void>;
}

export interface LearnedProfileSummary {
  domain: string;
  isJavaScriptHeavy: boolean;
  selectors: { list: string[]; detail: string[]; pagination: unknown };
  stats: { totalJobs: number; successfulJobs: number };
}

/** Lectura del perfil aprendido del sitio (MongoDB en producción). */
export interface SiteProfileReader {
  getSummary(url: string): Promise<LearnedProfileSummary | null>;
}

/** Cifrado de credenciales de sesión; la disponibilidad la decide el borde. */
export interface SessionCredentials {
  isEnabled(): boolean;
  encrypt(value: unknown): string;
}

/** Operaciones de jobs que necesita una sesión, sin acoplarse al HTTP ni a Nest. */
export interface SessionJobGateway {
  createJob(input: { url: string; instruction: string; sessionId: string; scope: string }): Promise<{ id: string; status: string }>;
  getJob(id: string, scope: string): Promise<{ status: string } | null>;
  getResults(id: string, scope: string): Promise<{ items: unknown[] } | null>;
}
