import { PrismaClient } from '@prisma/client';
import type { JobStore } from '@ai-scraper/application-execution';
import { InMemoryJobStore } from './memory-store';
import { PrismaJobStore } from './prisma-store';

let singleton: JobStore | null = null;
let prismaClient: PrismaClient | null = null;

function allowMemoryFallback(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.ALLOW_IN_MEMORY_FALLBACK === '1';
}

export function getPrismaClient(): PrismaClient {
  if (!prismaClient) prismaClient = new PrismaClient();
  return prismaClient;
}

async function canConnect(client: PrismaClient, timeoutMs = 3000): Promise<boolean> {
  try {
    await Promise.race([
      client.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error('db timeout')), timeoutMs)),
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Factoría FASE 7: PostgreSQL si DATABASE_URL responde, si no memoria (dev/tests).
 * El fallback se avisa por log; nunca se oculta en silencio.
 */
export async function createJobStore(): Promise<JobStore> {
  if (singleton) return singleton;
  if (process.env.DATABASE_URL) {
    const client = getPrismaClient();
    if (await canConnect(client)) {
      singleton = new PrismaJobStore(client);
      console.log('[STORAGE] PostgreSQL conectado (Prisma)');
      return singleton;
    }
    console.warn('[STORAGE] DATABASE_URL no responde — usando memoria (los datos no persistirán)');
    await client.$disconnect().catch(() => undefined);
  } else {
    console.warn('[STORAGE] Sin DATABASE_URL — usando memoria (los datos no persistirán)');
  }
  if (!allowMemoryFallback()) {
    throw new Error('PostgreSQL no disponible en producción; fallback en memoria deshabilitado');
  }
  singleton = new InMemoryJobStore();
  return singleton;
}

/** Solo tests: resetea el singleton entre casos. */
export function __resetJobStoreSingleton(): void {
  singleton = null;
}

/** Cierra el store (desconecta Prisma) para apagado graceful. */
export async function closeJobStore(): Promise<void> {
  if (prismaClient) {
    await prismaClient.$disconnect().catch(() => undefined);
    prismaClient = null;
  }
  singleton = null;
}
