/**
 * Cifrado de credenciales en reposo (AES-256-GCM).
 * La clave viene de CREDENTIALS_KEY (hex de 64 chars o frase → scrypt).
 * Nunca se registran credenciales en logs.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

function key(): Buffer {
  const raw = (process.env.CREDENTIALS_KEY ?? '').trim();
  if (!raw) throw new Error('CREDENTIALS_KEY no configurada (requerida para guardar credenciales)');
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  return scryptSync(raw, 'ai-scraper-credentials', 32);
}

export function hasCredentialsKey(): boolean {
  return Boolean((process.env.CREDENTIALS_KEY ?? '').trim());
}

export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${data.toString('base64')}`;
}

export function decryptJson<T = unknown>(cipherText: string): T {
  const [ivB, tagB, dataB] = cipherText.split('.');
  if (!ivB || !tagB || !dataB) throw new Error('credenciales cifradas inválidas');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  const out = Buffer.concat([decipher.update(Buffer.from(dataB, 'base64')), decipher.final()]);
  return JSON.parse(out.toString('utf8')) as T;
}
