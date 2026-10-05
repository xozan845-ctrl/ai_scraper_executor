/**
 * Utilidad para hashear contraseñas de forma segura.
 * Usa bcrypt bajo el capó (Node native es compatible desde v18+).
 * Nunca almacena la plaintext después del hash.
 *
 * Política "ningún dato se siembre":
 * - El hash se guarda en BD.
 * - La plaintext existe solo en este request y se deja al GC.
 * - Los logs nunca deben contener la plaintext (usar redactores de logger).
 */
import bcrypt from 'bcrypt';
export function hashPassword(plain: string): Promise<string> {
  const rounds = Number(process.env.BCRYPT_ROUNDS ?? 10);
  return bcrypt.hash(plain, rounds);
}

/**
 * Genera una API key aleatoria segura.
 * Formato: "sk-<22_base64chars>" compatible con el guard existente.
 *
 * Política "ningún dato se siembre":
 * - Se genera en memoria y se devuelve solo en la respuesta del registro.
 * - No se loguea el valor completo (solo los primeros 8 chars en logs audit).
 */
import crypto from 'crypto';
export function generateApiKey(): string {
  const bytes = crypto.randomBytes(32);
  const b64 = bytes.toString('base64'); // 44 chars base64
  return `sk-${b64.substring(0, 22)}`; // 22 chars after sk-
}