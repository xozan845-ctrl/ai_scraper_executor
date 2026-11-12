import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import http from 'node:http';

const {
  createJobUseCases,
  JobUrlRejectedError,
} = await import('../libs/application/execution/dist/index.js');
const { processJob } = await import('../libs/application/scraper/dist/index.js');
const { HttpWebhookNotifier } = await import('../libs/infrastructure/webhooks/dist/index.js');
const { InMemoryJobStore } = await import('../libs/infrastructure/storage/dist/memory-store.js');
const { InMemoryJobQueue } = await import('../libs/infrastructure/queue/dist/memory-queue.js');

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}/hook` });
    });
  });
}

function stopServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

const event = {
  event: 'job.completed',
  jobId: 'job_1',
  status: 'COMPLETED',
  url: 'https://shop.com/',
  itemsCount: 3,
  timestamp: '2026-01-01T00:00:00.000Z',
};

describe('N1 — webhooks de finalización', () => {
  it('CreateJob persiste webhookUrl y rechaza hosts privados (SSRF)', async () => {
    const store = new InMemoryJobStore();
    const queue = new InMemoryJobQueue();
    const useCases = createJobUseCases({
      store,
      queue,
      policy: { allowedDomains: [], allowPrivateHosts: false },
    });

    const view = await useCases.create.execute({
      url: 'https://shop.com/',
      instruction: 'productos',
      webhookUrl: 'https://hooks.example.com/scraping',
    });
    assert.equal(view.webhookUrl, 'https://hooks.example.com/scraping');
    assert.equal((await store.getJob(view.id)).webhookUrl, 'https://hooks.example.com/scraping');

    await assert.rejects(
      () => useCases.create.execute({
        url: 'https://shop.com/',
        instruction: 'productos',
        webhookUrl: 'http://127.0.0.1:8080/hook',
      }),
      (error) => error instanceof JobUrlRejectedError && /Webhook URL rechazada/.test(error.message),
    );
  });

  it('notifica con HMAC-SHA256 y cabeceras de evento', async () => {
    let received;
    const { server, url } = await startServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        received = { headers: req.headers, body: JSON.parse(body) };
        res.writeHead(204).end();
      });
    });

    try {
      const notifier = new HttpWebhookNotifier({
        secret: 'super-secret',
        allowPrivateHosts: true,
        timeoutMs: 2000,
        baseDelayMs: 1,
      });
      await notifier.notify(url, event);

      assert.equal(received.body.event, 'job.completed');
      assert.equal(received.headers['x-webhook-id'], 'job_1');
      assert.equal(received.headers['x-webhook-event'], 'job.completed');
      const expected = createHmac('sha256', 'super-secret').update(JSON.stringify(event)).digest('hex');
      assert.equal(received.headers['x-webhook-signature'], `sha256=${expected}`);
    } finally {
      await stopServer(server);
    }
  });

  it('reintenta 5xx y no reintenta 4xx deterministas', async () => {
    let attempts = 0;
    const { server, url } = await startServer((_req, res) => {
      attempts += 1;
      res.writeHead(attempts === 1 ? 500 : 204).end();
    });
    try {
      const notifier = new HttpWebhookNotifier({ allowPrivateHosts: true, baseDelayMs: 1, maxAttempts: 3 });
      await notifier.notify(url, event);
      assert.equal(attempts, 2);
    } finally {
      await stopServer(server);
    }

    let rejects = 0;
    const bad = await startServer((_req, res) => {
      rejects += 1;
      res.writeHead(400).end();
    });
    try {
      const notifier = new HttpWebhookNotifier({ allowPrivateHosts: true, baseDelayMs: 1, maxAttempts: 3 });
      await assert.rejects(() => notifier.notify(bad.url, event), /400/);
      assert.equal(rejects, 1);
    } finally {
      await stopServer(bad.server);
    }
  });

  it('bloquea un webhook a host privado sin bypass', async () => {
    const notifier = new HttpWebhookNotifier({ allowPrivateHosts: false, maxAttempts: 1 });
    await assert.rejects(() => notifier.notify('http://127.0.0.1:1/hook', event), /SSRF|bloqueado/);
  });

  it('processJob notifica el estado final y un fallo de webhook no tumba el job', async () => {
    const engine = {
      async execute(command) {
        if (command.type === 'NAVIGATE') return { ok: true, commandType: 'NAVIGATE' };
        if (command.type === 'FINISH') return { ok: true, commandType: 'FINISH' };
        return { ok: true, commandType: command.type };
      },
      getMemory: () => ({ visited: [], lastUrl: null, lastItems: 0, discoveredSelectors: [] }),
      getCurrentUrl: () => 'https://shop.com/',
    };
    const orchestrator = {
      providerName: 'fake',
      cacheHitCount: 0,
      lastCallTokens: () => 0,
      lastStats: () => null,
      createPlan: async () => ({
        version: '1.0',
        actions: [{ type: 'NAVIGATE', url: 'https://shop.com/' }, { type: 'FINISH' }],
      }),
      analyzePage: async () => [{ type: 'FINISH' }],
      recover: async () => [],
      interpret: async (ctx) => ctx.rawItems,
    };
    const notifications = [];

    const store = new InMemoryJobStore();
    const job = await store.createJob({
      url: 'https://shop.com/',
      instruction: 'x',
      webhookUrl: 'https://hooks.example.com/scraping',
    });
    const result = await processJob(job.id, {
      store,
      createOrchestrator: () => orchestrator,
      createEngine: () => engine,
      allowPrivateHosts: false,
      webhookNotifier: {
        async notify(url, notification) {
          notifications.push({ url, notification });
          throw new Error('receptor caído');
        },
      },
    });

    assert.equal(result.status, 'COMPLETED');
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].url, 'https://hooks.example.com/scraping');
    assert.equal(notifications[0].notification.event, 'job.completed');
    assert.equal((await store.getJob(job.id)).status, 'COMPLETED');
    assert.ok((await store.getErrors(job.id)).some((row) => /Webhook fallido/.test(row.message)));
  });
});
