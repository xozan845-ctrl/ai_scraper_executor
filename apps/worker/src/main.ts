import { incMetric } from './metrics-bridge';
import { createProductionEngine, closeProductionBrowser } from './browser-engine';
import { siteMemory } from './site-memory';
import { AIOrchestrator } from '@ai-scraper/application-ai';
import { AgentRunner, processJob, runHeuristicAgentLoop } from '@ai-scraper/application-scraper';
import { createAIProviderForJob, createFallbackProvider, withCircuitBreaker } from '@ai-scraper/infrastructure-ai-providers';
import { HttpWebhookNotifier } from '@ai-scraper/infrastructure-webhooks';
import { createJobStore, closeJobStore, createScheduleStore, createSessionStore } from '@ai-scraper/infrastructure-storage';
import { createJobQueue, createScrapingWorker, createRedisConnection, closeJobQueue, createDeadLetterQueue, queueRedisUrl } from '@ai-scraper/infrastructure-queue';
import { createJobUseCases, createScheduleUseCases } from '@ai-scraper/application-execution';
import { getScheduleLock, publishProgress } from '@ai-scraper/infrastructure-redis';
import { disconnectMongo } from '@ai-scraper/infrastructure-mongodb';
import { getJsonCache } from '@ai-scraper/infrastructure-redis';
import { runWithContext } from '@ai-scraper/shared-observability';
import { decryptJson, isPrivateHostsAllowed } from '@ai-scraper/shared-security';

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
  const sessionStore = await createSessionStore();
  const scheduleStore = createScheduleStore();
  const scheduleLock = await getScheduleLock();
  const policy = {
    allowedDomains: (process.env.ALLOWED_DOMAINS ?? '')
      .split(',')
      .map((domain) => domain.trim().toLowerCase())
      .filter(Boolean),
    allowPrivateHosts: isPrivateHostsAllowed(),
  };
  const jobUseCases = createJobUseCases({
    store,
    queue,
    policy,
    metrics: { inc: (name) => incMetric(name) },
  });
  const scheduleUseCases = createScheduleUseCases({
    store: scheduleStore,
    createJob: jobUseCases.create,
    lock: scheduleLock,
    policy,
    metrics: { inc: (name) => incMetric(name) },
  });

  // Carga credenciales (headers) de la sesión y las descifra para el engine.
  const getCredentials = async (sessionId: string): Promise<{ headers?: Record<string, string> } | null> => {
    try {
      const s = await sessionStore.getSession(sessionId);
      if (!s?.credentials) return null;
      return decryptJson<{ headers?: Record<string, string> }>(s.credentials);
    } catch {
      return null;
    }
  };

  let closing = false;
  let worker: { close: () => Promise<void> } | null = null;
  let connection: { disconnect: () => void } | null = null;
  let deadQueue: { close: () => Promise<void> } | null = null;
  let schedulerTimer: NodeJS.Timeout | null = null;

  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`[WORKER] ${signal} — apagando (esperando job en curso)...`);
    if (schedulerTimer) clearInterval(schedulerTimer);
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
  const debug = process.env.DEBUG === '1' || process.env.LOG_LEVEL === 'debug';
  const webhookNotifier = new HttpWebhookNotifier({
    ...(process.env.WEBHOOK_SIGNING_SECRET ? { secret: process.env.WEBHOOK_SIGNING_SECRET } : {}),
    allowPrivateHosts: isPrivateHostsAllowed(),
    timeoutMs: Number(process.env.WEBHOOK_TIMEOUT_MS ?? 5000),
    maxAttempts: Number(process.env.WEBHOOK_MAX_ATTEMPTS ?? 3),
  });

  const schedulerTickMs = Math.max(1000, Number(process.env.SCHEDULER_TICK_MS ?? 15000));
  let scheduleTickRunning = false;
  schedulerTimer = setInterval(() => {
    if (scheduleTickRunning) return;
    scheduleTickRunning = true;
    void scheduleUseCases.runDue.execute(Number(process.env.SCHEDULER_BATCH ?? 50))
      .then((result) => {
        if (result.run > 0 || result.failed > 0) {
          console.log(`[SCHEDULER] run=${result.run} failed=${result.failed} skipped=${result.skipped}`);
        }
      })
      .catch((error) => console.error('[SCHEDULER] error:', (error as Error).message))
      .finally(() => { scheduleTickRunning = false; });
  }, schedulerTickMs);
  schedulerTimer.unref?.();
  console.log(`[SCHEDULER] activo (tick=${schedulerTickMs}ms)`);

  // Consumidor BullMQ cuando hay Redis real (R-RD-1: la cola puede usar su propia URL).
  const bullUrl = queueRedisUrl();
  if (queue.kind === 'bullmq' && bullUrl) {
    connection = createRedisConnection(bullUrl);
    const bullWorker = createScrapingWorker(
      connection as never,
      async (bullJob) => {
        const { jobId, correlationId } = bullJob.data;
        return runWithContext({ jobId, correlationId }, async () => {
          console.log(`[WORKER] job recibido: ${jobId}`);
          try {
            const result = await processJob(jobId, {
              store,
              getCredentials,
              siteMemory,
              allowPrivateHosts: isPrivateHostsAllowed(),
              metrics: { inc: (name, by) => incMetric(name, by) },
              webhookNotifier,
              onProgress: (event) => { void publishProgress(event).catch(() => undefined); },
              interpret: process.env.AI_INTERPRET === '1',
              debug,
              createOrchestrator: async (payload) => {
                const cache = process.env.AI_CACHE === '0' ? null : await getJsonCache();
                return new AIOrchestrator(withCircuitBreaker(createAIProviderForJob(payload.ai) as never), cache);
              },
              createEngine: (hint) => createProductionEngine({
                ...(hint.headers ? { headers: hint.headers } : {}),
                allowedDomain: hint.allowedDomain,
                credentialOrigin: hint.credentialOrigin,
                signal: hint.signal,
                learnedSelectors: hint.learnedSelectors,
                ...(hint.render ? { render: hint.render } : {}),
              }),
            });
            console.log(`[WORKER] ${jobId} ${result.status} (${result.items.length} items)`);
            if (result.status === 'NEEDS_HUMAN') {
              console.warn(`[WORKER] ${jobId} requiere intervención humana: ${result.error ?? 'reto anti-bot'}`);
              return;
            }
            if (result.status !== 'COMPLETED') throw new Error(result.error ?? `job ${result.status.toLowerCase()}`);
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
          .then(() => {
            incMetric('jobs_dead_total');
            console.error(`[WORKER] ${job.data.jobId} → DLQ`);
          })
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
      await runHeuristicAgentLoop(job, {
        engine: createProductionEngine(),
        allowPrivateHosts: isPrivateHostsAllowed(),
      });
      await shutdown('demo-complete');
      return;
    }
    const provider = createFallbackProvider(process.env.AI_PROVIDER);
    const runner = new AgentRunner({
      orchestrator: new AIOrchestrator(withCircuitBreaker(provider as never)),
      createEngine: () => createProductionEngine(),
      siteMemory,
      allowPrivateHosts: isPrivateHostsAllowed(),
      debug,
    });
    const result = await runner.run(job);
    console.log(
      `[JOB] ${job.id} ${result.status} :: ${result.steps.length} pasos, ` +
        `${result.items.length} items, recovery=${result.recoveryCount}, provider=${result.providerName}`,
    );
    if (result.status !== 'COMPLETED') process.exitCode = 1;
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
