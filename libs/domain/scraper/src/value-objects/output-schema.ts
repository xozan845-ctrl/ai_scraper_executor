/** Esquema de salida por campo (tipos/validación) acordado con el cliente. */
export type FieldType = 'string' | 'number' | 'price' | 'url' | 'date' | 'email' | 'boolean';

export interface FieldSchema {
  type?: FieldType;
  required?: boolean;
  pattern?: string;
  min?: number;
  max?: number;
  enum?: string[];
}

export interface OutputSchema {
  strict?: boolean;
  fields: Record<string, FieldSchema>;
}
