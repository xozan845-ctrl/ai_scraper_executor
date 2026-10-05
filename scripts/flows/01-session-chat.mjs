import { readJsonEnv, waitFor } from '../harness.mjs';

export default {
  name: '01-session-chat',
  slow: true,
  async run(c, t) {
    const url = process.env.TEST_URL || 'https://www.sevasaonline.com/';
    const headers = readJsonEnv('TEST_HEADERS_JSON', null);
    const prompts = readJsonEnv('TEST_PROMPTS_JSON', [
      'Obtén todos los productos con nombre, precio e imagen',
    ]);
    const requireItems = process.env.TEST_REQUIRE_ITEMS !== '0';

    if (!Array.isArray(prompts) || prompts.length === 0 || prompts.some((p) => typeof p !== 'string' || !p.trim())) {
      throw new Error('TEST_PROMPTS_JSON debe ser un array no vacío de strings');
    }

    t.step(`1) Crear sesión (chat) para ${url}`);
    const sessionBody = { url, ...(headers ? { credentials: { headers } } : {}) };
    const s = await c.createSession(sessionBody);
    t.assert(s.status === 'RADIOGRAPHY', `sesión ${s.id} status=${s.status}`);
    t.ok(headers ? 'headers reales enviados (no se imprimen)' : 'sesión sin credenciales');

    t.step('2) Esperar radiografía (el input del chat debe estar BLOQUEADO hasta READY)');
    await waitFor(async () => {
      const st = await c.sessionStatus(s.id);
      t.info(`status = ${st.status}`);
      if (st.status === 'FAILED') throw new Error(`radiografía FAILED: ${st.error}`);
      return st.status === 'READY';
    });
    t.ok('READY — input desbloqueado');

    for (let i = 0; i < prompts.length; i += 1) {
      const prompt = prompts[i];
      t.step(`3.${i + 1}) Enviar prompt ${i + 1}/${prompts.length}`);
      const m = await c.sendMessage(s.id, prompt);
      t.assert(Boolean(m.jobId), `job ${m.jobId} status=${m.jobStatus}`);

      t.step(`4.${i + 1}) Esperar fin del job`);
      const job = await waitFor(async () => {
        const j = await c.getJob(m.jobId);
        t.info(`job ${m.jobId} status = ${j.status}`);
        return ['COMPLETED', 'FAILED', 'CANCELLED'].includes(j.status) ? j : null;
      });
      if (job.status !== 'COMPLETED') {
        const execution = await c.jobExecution(m.jobId).catch(() => null);
        throw new Error(`job ${m.jobId} terminó ${job.status}: ${JSON.stringify(execution?.errors ?? job)}`);
      }
      t.ok(`job ${job.status}`);

      t.step(`5.${i + 1}) Resultados del prompt`);
      const res = await c.jobResults(m.jobId);
      t.ok(`${res.count} resultados`);
      if (requireItems && (!res.items || res.items.length === 0)) {
        throw new Error(`job ${m.jobId} completó sin resultados para el prompt: ${prompt}`);
      }
      if (res.items?.length) t.info(`primer item: ${JSON.stringify(res.items[0]).slice(0, 200)}`);
    }

    t.step('6) Historial de la sesión (contexto continuo para el chat)');
    const detail = await c.getSession(s.id);
    t.ok(`mensajes=${detail.messages.length} perfil=${detail.profile?.domain ?? 'n/a'}`);
    const last = detail.messages[detail.messages.length - 1];
    t.ok(`último mensaje: role=${last.role} jobStatus=${last.jobStatus} resultados=${last.results?.length ?? 0}`);
    t.assert(detail.messages.length >= prompts.length * 2, 'cada prompt deja mensaje user + assistant');
  },
};
