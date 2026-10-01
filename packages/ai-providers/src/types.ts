/** Tipos compartidos de la capa de proveedores (§14). */
export interface ProviderCallOpts {
  /** Precedencia: opts.model > context.model > modelo por defecto del proveedor. */
  model?: string;
}

export interface ProviderStats {
  latencyMs: number;
  tokens?: number;
  model: string;
  provider: string;
}
