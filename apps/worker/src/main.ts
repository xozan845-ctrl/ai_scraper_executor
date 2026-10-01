import { runAgentLoop } from './agent-loop';
import { AgentRunner } from './agent-runner';
import { processJob } from './job-processor';
import { AIOrchestrator } from '@ai-scraper/ai';
import { createFallbackProvider } from '@ai-scraper/ai-providers';
import { createJobStore } from '@ai-scraper/storage';
import { createJobQueue, createScrapingWorker, createRedisConnection } from '@ai-scraper/queue';

/**
 * Worker entrypoint — FASE 7.
 * - Con REDIS_URL válido: consume la cola BullMQ (scraping-jobs) y persiste en DB.
 * - Con DEMO_URL: ejecución directa (útil sin Redis/LLM: usa heuística si no hay claves).
 */
async function main() {
  console.log('[WORKER] iniciado.');
  const store = await createJobStore();
  const queue = await createJobQueue();

  const hasLlm = Boolean(process.env.OPENROUTER_API_KEY ?? process.env.AI_CUSTOM_ENDPOINT);

  // Consumidor BullMQ cuando hay Redis real.
  if (queue.kind === 'bullmq' && process.env.REDIS_URL) {
    const connection = createRedisConnection(process.env.REDIS_URL);
    const worker = createScrapingWorker(
      connection,
      async (bullJob) => {
        const { jobId } = bullJob.data;
        console.log(`[WORKER] job recibido: ${jobId}`);
        try {
          const result = await processJob(jobId, { store });
          console.log(`[WORKER] ${jobId} ${result.status} (${result.items.length} items)`);
          if (result.status === 'FAILED') throw new Error(result.error ?? 'job fallido');
        } catch (e) {
          console.error(`[WORKER] ${jobId} error: ${(e as Error).message}`);
          throw e;
        }
      },
      { concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2) },
    );
    worker.on('failed', (job, err) => console.error(`[WORKER] ${job?.data?.jobId} failed: ${err.message}`));
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
      return;
    }
    const provider = createFallbackProvider(process.env.AI_PROVIDER);
    const runner = new AgentRunner({ orchestrator: new AIOrchestrator(provider as never) });
    const result = await runner.run(job);
    console.log(
      `[JOB] ${job.id} ${result.status} :: ${result.steps.length} pasos, ` +
        `${result.items.length} items, recovery=${result.recoveryCount}, provider=${result.providerName}`,
    );
    if (result.status === 'FAILED') process.exitCode = 1;
    return;
  }

  // Sin Redis ni DEMO_URL: drenar cola en memoria por si la API encoló en el mismo proceso (tests).
  console.log(`[WORKER] Sin REDIS_URL ni DEMO_URL — idle (store=${store.kind}, queue=${queue.kind}).`);
  setInterval(() => undefined, 60_000);
}

main().catch((e) => {
  console.error('[WORKER] fatal', e);
  process.exit(1);
});
