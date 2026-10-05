export default {
  name: '00-health',
  slow: false,
  async run(c, t) {
    t.step('Health (liveness + readiness)');
    const h = await c.health();
    t.assert(h.status === 'ok', `liveness ok (service=${h.service})`);

    try {
      const r = await c.ready();
      t.ok(`readiness ${r.status} checks=${JSON.stringify(r.checks)}`);
    } catch (e) {
      t.warn(`readiness no OK: ${e.message.split('\n')[0]}`);
    }

    t.step('OpenAPI');
    try {
      await c.openapi();
      t.ok('OpenAPI docs-json disponible en /api/v1/docs');
    } catch (e) {
      t.warn(`docs-json no disponible: ${e.message.split('\n')[0]}`);
    }
  },
};
