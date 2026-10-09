#!/usr/bin/env node
import { getPrismaClient } from '../libs/infrastructure/storage/dist/index.js';

/**
 * Retención explícita de artefactos de job (R-DI-8). No es una cascada silenciosa:
 * es un comando que se ejecuta a mano o por cron y dice lo que borra.
 *
 * Se conservan `Job` y `Result` (verdad transaccional + trazabilidad), `JobError`
 * (auditoría de fallos) y `Session`/`SessionMessage` (historial de chat). Se purgan
 * solo los artefactos pesados y derivados: `Page`, `Command` y `AIInteraction`.
 *
 * Ventana: `RETENTION_ARTIFACT_DAYS` (por defecto 30).
 */

const days = Number(process.env.RETENTION_ARTIFACT_DAYS ?? 30);
if (!Number.isFinite(days) || days <= 0) {
  console.error(`[retention] RETENTION_ARTIFACT_DAYS inválido: ${process.env.RETENTION_ARTIFACT_DAYS}`);
  process.exit(1);
}
const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
const prisma = getPrismaClient();

try {
  const [pages, commands, ai] = await prisma.$transaction([
    prisma.page.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    prisma.command.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    prisma.aIInteraction.deleteMany({ where: { createdAt: { lt: cutoff } } }),
  ]);
  console.log(
    `[retention] corte ${cutoff.toISOString()} (${days} días): ` +
      `Page=${pages.count} Command=${commands.count} AIInteraction=${ai.count}`,
  );
} catch (e) {
  console.error(`[retention] error: ${e.message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect().catch(() => undefined);
}
