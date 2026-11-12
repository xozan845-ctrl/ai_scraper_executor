/**
 * Hash de contraseñas (bcrypt). La plaintext solo vive en el request y se
 * descarta; nunca se loguea completa.
 */
import bcrypt from 'bcrypt';

export function hashPassword(plain: string): Promise<string> {
  const rounds = Number(process.env.BCRYPT_ROUNDS ?? 10);
  return bcrypt.hash(plain, rounds);
}
