import { runAgentLoop } from './agent-loop';
import { AgentRunner } from './agent-runner';
import { processJob } from './job-processor';
import { createProductionEngine, closeProductionBrowser } from './browser-engine';
import { AIOrchestrator } from '@ai-scraper/ai';
import { createFallbackProvider, withCircuitBreaker } from '@ai-scraper/ai-providers';
import { createJobStore, closeJobStore } from '@ai-scraper/storage';
import { createJobQueue, createScrapingWorker, createRedisConnection, closeJobQueue, createDeadLetterQueue } from '@ai-scraper/queue';
import { disconnectMongo } from '@ai-scraper/mongodb';
import { runWithContext } from '@ai-scraper/observability';

/**
 * Worker entrypoint — FASE 7.
 * - Con REDIS_URL válido: consume la cola BullMQ (scraping-jobs) y persiste en DB.
 * - Con DEMO_URL: ejecución directa (útil sin Redis/LLM: usa heurística si no hay claves).
 * - Apagado graceful ante SIGTERM/SIGINT: drena el job activo y cierra conexiones.
 */
async function main() {
  console.log('[WORKER] iniciado.');
  const store = await createJobStore();
  const queue = await createJobQueue();

  let closing = false;
  let worker: { close: () => Promise<void> } | null = null;
  let connection: { disconnect: () => void } | null = null;
  let deadQueue: { close: () => Promise<void> } | null = null;

  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`[WORKER] ${signal} — apagando (esperando job en curso)...`);
    try {
      if (worker) await worker.close(); // espera a que termine el job activo
    } catch (e) {
      console.error('[WORKER] error cerrando worker:', (e as Error).message);
    }
    try {
      if (deadQueue) await deadQueue.close();
    } catch { /* noop */ }
    try {
      if (connection) connection.disconnect();
    } catch { /* noop */ }
    await closeJobQueue().catch(() => undefined);
    await closeJobStore().catch(() => undefined);
    await disconnectMongo().catch(() => undefined);
    await closeProductionBrowser().catch(() => undefined);
    console.log('[WORKER] cerrado.');
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  const hasLlm = Boolean(process.env.OPENROUTER_API_KEY ?? process.env.AI_CUSTOM_ENDPOINT);

  // Consumidor BullMQ cuando hay Redis real.
  if (queue.kind === 'bullmq' && process.env.REDIS_URL) {
    connection = createRedisConnection(process.env.REDIS_URL);
    const bullWorker = createScrapingWorker(
      connection as never,
      async (bullJob) => {
        const { jobId, correlationId } = bullJob.data;
        return runWithContext({ jobId, correlationId }, async () => {
          console.log(`[WORKER] job recibido: ${jobId}`);
          try {
            const result = await processJob(jobId, { store, createEngine: createProductionEngine });
            console.log(`[WORKER] ${jobId} ${result.status} (${result.items.length} items)`);
            if (result.status === 'FAILED') throw new Error(result.error ?? 'job fallido');
          } catch (e) {
            console.error(`[WORKER] ${jobId} error: ${(e as Error).message}`);
            throw e;
          }
        });
      },
      { concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2) },
    );
    worker = bullWorker as unknown as { close: () => Promise<void> };
    const dead = createDeadLetterQueue(connection as never);
    deadQueue = dead as unknown as { close: () => Promise<void> };
    bullWorker.on('failed', (job, err) => {
      const attempts = (job?.opts?.attempts as number | undefined) ?? 1;
      const made = job?.attemptsMade ?? 0;
      console.error(`[WORKER] ${job?.data?.jobId} failed (intento ${made}/${attempts}): ${err.message}`);
      // DLQ: solo cuando se agotan los reintentos.
      if (job && made >= attempts) {
        void dead
          .add('dead', {
            ...job.data,
            reason: err.message,
            failedAt: new Date().toISOString(),
            attemptsMade: made,
          })
          .then(() => console.error(`[WORKER] ${job.data.jobId} → DLQ`))
          .catch(() => undefined);
      }
    });
    console.log(`[WORKER] consumiendo cola "${queue.queueName}" (store=${store.kind})`);
    return; // Mantener vivo vía el worker BullMQ.
  }

  const demoUrl = process.env.DEMO_URL;
  if (demoUrl) {
    const job = {
      id: 'job_demo',
      url: demoUrl,
      instruction: process.env.DEMO_INSTRUCTION ?? 'Obtén todos los productos',
    };
    if (!hasLlm) {
      console.log('[WORKER] Sin claves LLM — loop heurístico sin IA (FASE 2).');
      await runAgentLoop(job);
      await shutdown('demo-complete');
      return;
    }
    const provider = createFallbackProvider(process.env.AI_PROVIDER);
    const runner = new AgentRunner({ orchestrator: new AIOrchestrator(withCircuitBreaker(provider as never)), createEngine: createProductionEngine });
    const result = await runner.run(job);
    console.log(
      `[JOB] ${job.id} ${result.status} :: ${result.steps.length} pasos, ` +
        `${result.items.length} items, recovery=${result.recoveryCount}, provider=${result.providerName}`,
    );
    if (result.status === 'FAILED') process.exitCode = 1;
    await shutdown('demo-complete');
    return;
  }

  // Sin Redis ni DEMO_URL: idle hasta señal.
  console.log(`[WORKER] Sin REDIS_URL ni DEMO_URL — idle (store=${store.kind}, queue=${queue.kind}).`);
  setInterval(() => undefined, 60_000);
}

main().catch((e) => {
  console.error('[WORKER] fatal', e);
  process.exit(1);
});
