/**
 * Utilidades de credenciales: hash de contraseñas (bcrypt) y generación de API keys.
 * La plaintext de la contraseña solo vive en el request y se descarta (GC).
 * Nunca se loguea completa.
 */
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';

export function hashPassword(plain: string): Promise<string> {
  const rounds = Number(process.env.BCRYPT_ROUNDS ?? 10);
  return bcrypt.hash(plain, rounds);
}

/** Genera una API key aleatoria: "sk-<22 chars base64url>". */
export function generateApiKey(): string {
  const bytes = crypto.randomBytes(32);
  const b64 = bytes.toString('base64');
  return `sk-${b64.substring(0, 22)}`;
}
