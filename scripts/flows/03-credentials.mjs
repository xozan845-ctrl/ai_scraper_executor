import { readJsonEnv, waitFor } from '../harness.mjs';

export default {
  name: '03-credentials',
  slow: true,
  async run(c, t) {
    const url = process.env.TEST_URL || 'https://www.sevasaonline.com/';
    const headers = readJsonEnv('TEST_HEADERS_JSON', null);
    if (!headers) {
      t.warn('TEST_HEADERS_JSON no configurado; se omite el flujo autenticado real');
      return;
    }

    t.step('Sesión con credenciales (headers: Authorization/Cookie)');
    const s = await c.createSession({ url, credentials: { headers } });
    t.ok(`creada con credenciales: ${s.id} status=${s.status}`);
    t.assert(!s.credentials, 'la respuesta no incluye credenciales');

    t.step('Esperar radiografía autenticada');
    await waitFor(async () => {
      const st = await c.sessionStatus(s.id);
      t.info(`status = ${st.status}`);
      if (st.status === 'FAILED') throw new Error(`radiografía autenticada FAILED: ${st.error}`);
      return st.status === 'READY';
    });
    t.ok('radiografía autenticada READY');

    t.step('Enviar prompt después de READY');
    const m = await c.sendMessage(s.id, process.env.TEST_CREDENTIAL_PROMPT || 'Obtén los datos disponibles de la página');
    const job = await waitFor(async () => {
      const j = await c.getJob(m.jobId);
      t.info(`job status = ${j.status}`);
      return ['COMPLETED', 'FAILED', 'CANCELLED'].includes(j.status) ? j : null;
    });
    if (job.status !== 'COMPLETED') {
      const execution = await c.jobExecution(m.jobId).catch(() => null);
      throw new Error(`job autenticado terminó ${job.status}: ${JSON.stringify(execution?.errors ?? job)}`);
    }
    const results = await c.jobResults(m.jobId);
    t.ok(`job autenticado COMPLETED con ${results.count} resultados`);

    const d = await c.getSession(s.id);
    t.assert(!d.credentials, 'el detalle tampoco expone credenciales');
  },
};
