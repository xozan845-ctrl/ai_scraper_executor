export default {
  name: '04-jobs',
  slow: false,
  async run(c, t) {
    const url = process.env.TEST_URL || 'https://www.sevasaonline.com/';

    t.step('Jobs: crear / listar (cursor + filtro)');
    const j = await c.createJob({ url, instruction: 'Obtén productos', priority: 3 });
    t.ok(`job ${j.id} status=${j.status} priority=3`);

    const page = await c.listJobs('?limit=5');
    t.ok(`list items=${page.items.length} nextCursor=${page.nextCursor}`);
    const failed = await c.listJobs('?status=FAILED&limit=5');
    t.ok(`filtro status=FAILED items=${failed.items.length}`);

    t.step('Detalle / execution / ai');
    const exec = await c.jobExecution(j.id);
    t.ok(`execution commands=${exec.commands.length} pages=${exec.pages.length} errors=${exec.errors.length}`);
    const ai = await c.jobAi(j.id);
    t.ok(`ai calls=${ai.count}`);

    t.step('Idempotencia (Idempotency-Key)');
    const key = globalThis.crypto.randomUUID();
    const j1 = await c.createJob({ url, instruction: 'Idem test' }, key);
    const j2 = await c.createJob({ url, instruction: 'Idem test' }, key);
    t.assert(j1.id === j2.id, `misma clave -> mismo job (${j1.id})`);

    t.step('Cancelar');
    const cc = await c.cancelJob(j.id);
    t.assert(['CANCELLED', 'COMPLETED', 'FAILED'].includes(cc.status), `cancel -> ${cc.status}`);

    t.step('Retry de job inexistente -> 404');
    await t.expectFail(() => c.retryJob('job_inexistente'), /404|no encontrado/);
  },
};
