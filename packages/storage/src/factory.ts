import { PrismaClient } from '@prisma/client';
import type { JobStore } from './job-store';
import { InMemoryJobStore } from './memory-store';
import { PrismaJobStore } from './prisma-store';

let singleton: JobStore | null = null;
let prismaClient: PrismaClient | null = null;

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
  singleton = new InMemoryJobStore();
  return singleton;
}

/** Solo tests: resetea el singleton entre casos. */
export function __resetJobStoreSingleton(): void {
  singleton = null;
}
