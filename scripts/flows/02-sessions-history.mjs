export default {
  name: '02-sessions-history',
  slow: false,
  async run(c, t) {
    const url = process.env.TEST_URL || 'https://www.sevasaonline.com/';

    t.step('Historial de sesiones (barra lateral del chat)');
    const before = await c.listSessions();
    t.ok(`${before.length} sesiones antes`);

    const s = await c.createSession({ url });
    t.ok(`creada sesión ${s.id}`);

    const after = await c.listSessions();
    t.assert(after.some((x) => x.id === s.id), 'la sesión nueva aparece en el historial');
    t.ok(`${after.length} sesiones después`);

    const detail = await c.getSession(s.id);
    t.ok(`detalle: status=${detail.status} mensajes=${detail.messages.length} dominio=${detail.domain}`);
    t.assert(!detail.credentials, 'la API nunca devuelve credenciales');
  },
};
