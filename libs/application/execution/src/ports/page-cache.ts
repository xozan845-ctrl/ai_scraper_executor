export interface EnginePageCache {
  get(key: string): string | null | Promise<string | null>;
  set(key: string, html: string): void | Promise<void>;
  hits?: number;
  misses?: number;
  size?: number;
}
