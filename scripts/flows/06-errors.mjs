export default {
  name: '06-errors',
  slow: false,
  async run(c, t) {
    const url = process.env.TEST_URL || 'https://www.sevasaonline.com/';

    t.step('SSRF / validación de entrada');
    await t.expectFail(() => c.createSession({ url: 'http://169.254.169.254/latest/meta-data/' }), /rechazada|SSRF|dominio|URL/);
    await t.expectFail(() => c.createSession({ url: 'http://127.0.0.1:6379/' }), /rechazada|SSRF|dominio|URL/);
    await t.expectFail(() => c.createSession({ url: 'no-es-una-url' }), /url|URL/);
    await t.expectFail(() => c.createSession({}), /url|URL/);
    await t.expectFail(() => c.createJob({ url: 'https://example.com', instruction: 'x' }), /instruction|length/);

    t.step('Recursos inexistentes (404)');
    await t.expectFail(() => c.getJob('job_inexistente'), /404|no encontrado/);
    await t.expectFail(() => c.getSession('sess_inexistente'), /404|no encontrada/);
    await t.expectFail(() => c.sendMessage('sess_inexistente', 'hola'), /404|no encontrada/);
    await t.expectFail(() => c.cancelJob('job_inexistente'), /404|no encontrado/);

    t.step('Enviar mensaje antes de READY -> 409');
    const s = await c.createSession({ url });
    await t.expectFail(() => c.sendMessage(s.id, 'productos'), /no está lista|409/);

    t.step('Auth (si el servidor tiene API_KEYS)');
    if (c.hasKey) {
      const res = await fetch(`${c.baseUrl}/jobs`);
      if (res.status !== 401) throw new Error(`esperaba 401 sin x-api-key, recibí ${res.status}`);
      t.ok('401 sin API key');
    } else {
      t.warn('API_KEY no configurada en el cliente; se omite el test de 401');
    }
  },
};
