import { createHash, randomBytes } from 'node:crypto';

/** Hash de API key para comparar sin guardar el secreto en claro. */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** Genera una API key aleatoria: "sk-<22 chars base64>". */
export function generateApiKey(): string {
  return `sk-${randomBytes(32).toString('base64').substring(0, 22)}`;
}
