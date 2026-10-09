import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

describe('Resiliencia (Etapa 5): circuit breaker + semáforo', async () => {
  const { CircuitBreaker, __resetCircuitBreakers } = await import('../libs/infrastructure/ai-providers/dist/circuit-breaker.js');
  const { withCircuitBreaker } = await import('../libs/infrastructure/ai-providers/dist/resilient.js');
  const { Semaphore } = await import('../libs/infrastructure/crawler/dist/pool.js');

  it('CircuitBreaker: abre tras N fallos, half-open y cierra al recuperar', async () => {
    const b = new CircuitBreaker({ threshold: 2, cooldownMs: 40 });
    const fail = () => b.exec(async () => { throw new Error('boom'); });
    await assert.rejects(fail);
    await assert.rejects(fail);
    assert.equal(b.currentState, 'open');
    await assert.rejects(() => b.exec(async () => 1), /CircuitBreaker abierto/);
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(b.currentState, 'half-open');
    assert.equal(await b.exec(async () => 42), 42);
    assert.equal(b.currentState, 'closed');
  });

  it('withCircuitBreaker: no llama al proveedor cuando está abierto', async () => {
    __resetCircuitBreakers();
    let calls = 0;
    const provider = {
      name: 'cb-test',
      async createPlan() { calls += 1; throw new Error('x'); },
      async analyzePage() { return []; },
      async recover() { return []; },
      async interpret(c) { return c.rawItems; },
      getLastStats() { return null; },
    };
    const wrapped = withCircuitBreaker(provider, { threshold: 2, cooldownMs: 5000 });
    await assert.rejects(() => wrapped.createPlan({}));
    await assert.rejects(() => wrapped.createPlan({}));
    await assert.rejects(() => wrapped.createPlan({}), /CircuitBreaker abierto/);
    assert.equal(calls, 2, 'solo 2 llamadas reales; la 3ª falla rápido');
    assert.equal(wrapped.circuitState, 'open');
    __resetCircuitBreakers();
  });

  it('Semaphore: acota la concurrencia', async () => {
    const sem = new Semaphore(2);
    let active = 0;
    let max = 0;
    const task = async () => {
      const release = await sem.acquire();
      active += 1;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 10));
      active -= 1;
      release();
    };
    await Promise.all([task(), task(), task(), task(), task()]);
    assert.ok(max <= 2, `concurrencia ${max} <= 2`);
  });

  it('nombre de la cola DLQ válido para BullMQ (sin ":")', async () => {
    const { SCRAPING_DEAD_QUEUE } = await import('../libs/infrastructure/queue/dist/bullmq-queue.js');
    assert.ok(!SCRAPING_DEAD_QUEUE.includes(':'), `BullMQ v6 no permite ":" en nombres de cola: ${SCRAPING_DEAD_QUEUE}`);
  });
});
