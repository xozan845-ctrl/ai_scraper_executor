import { readJsonEnv, waitFor } from '../harness.mjs';

export default {
  name: '07-productos-stock-ventas',
  slow: true,
  async run(c, t) {
    const url = process.env.TEST_URL || 'https://www.sevasaonline.com/';
    const headers = readJsonEnv('TEST_HEADERS_JSON', null);
    const prompts = readJsonEnv('TEST_PROMPTS_JSON', [
      'Qué productos están disponibles',
      'Cuál es el stock actual',
      'Muestra las ventas del día',
    ]);

    if (!Array.isArray(prompts) || prompts.length === 0 || prompts.some((p) => typeof p !== 'string' || !p.trim())) {
      throw new Error('TEST_PROMPTS_JSON debe ser un array no vacío de strings');
    }

    t.step(`1) Crear sesión para ${url}`);
    console.log(`   [FLOW] URL objetivo: ${url}`);
    console.log(`   [FLOW] Headers: ${headers ? 'configurados' : 'sin headers'}`);
    const sessionBody = { url, ...(headers ? { credentials: { headers } } : {}) };
    const s = await c.createSession(sessionBody);
    t.assert(s.status === 'RADIOGRAPHY', `sesión ${s.id} status=${s.status}`);
    console.log(`   [FLOW] Sesión creada: ${s.id} status=RADIOGRAPHY`);

    t.step('2) Esperar radiografía (input bloqueado hasta READY)');
    await waitFor(async () => {
      const st = await c.sessionStatus(s.id);
      t.info(`status = ${st.status}`);
      if (st.status === 'FAILED') throw new Error(`radiografía FAILED: ${st.error}`);
      return st.status === 'READY';
    });
    t.ok('READY — input desbloqueado');
    console.log(`   [FLOW] Input desbloqueado, ready para prompts`);

    // Enviar cada prompt y esperar resultados
    for (let i = 0; i < prompts.length; i += 1) {
      const prompt = prompts[i];
      t.step(`3.${i + 1}) Enviar prompt ${i + 1}/${prompts.length}`);
      console.log(`   [FLOW] Prompt "${prompt.substring(0, 40)}..."`);
      const m = await c.sendMessage(s.id, prompt);
      t.assert(Boolean(m.jobId), `job ${m.jobId} status=${m.jobStatus}`);
      console.log(`   [FLOW] Job creado: ${m.jobId}`);

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
      console.log(`   [FLOW] Job completado: ${job.status}`);

      t.step(`5.${i + 1}) Resultados del prompt`);
      const res = await c.jobResults(m.jobId);
      t.ok(`${res.count} resultados`);
      console.log(`   [FLOW] Prompt "${prompt.substring(0, 40)}..." → ${res.count} items`);
      if (res.items?.length) t.info(`primer item: ${JSON.stringify(res.items[0]).slice(0, 200)}`);
    }

    t.step('6) Historial de la sesión (contexto continuo)');
    const detail = await c.getSession(s.id);
    t.ok(`mensajes=${detail.messages.length} perfil=${detail.profile?.domain ?? 'n/a'}`);
    const last = detail.messages[detail.messages.length - 1];
    t.ok(`último mensaje: role=${last.role} jobStatus=${last.jobStatus} resultados=${last.results?.length ?? 0}`);
    t.assert(detail.messages.length >= prompts.length * 2, 'cada prompt deja mensaje user + assistant');
    console.log(`   [FLOW] Historial: ${detail.messages.length} mensajes, perfil ${detail.profile?.domain}`);
  },
};