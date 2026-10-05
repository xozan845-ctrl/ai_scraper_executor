export default {
  name: '05-radiography',
  slow: true,
  async run(c, t) {
    const url = process.env.TEST_URL || 'https://www.sevasaonline.com/';

    t.step(`Radiografía directa (POST /radiography) para ${url}`);
    const r = await c.radiography({ url, maxDepth: 1, maxPages: 3, forceBrowser: true });
    t.ok(`perfil=${r.profileId} dominio=${r.domain}`);
    t.ok(`selectores lista=${r.discovered.listSelectors.length} detalle=${r.discovered.detailSelectors.length}`);

    t.step('Perfil aprendido y selectores');
    const p = await c.profile(r.domain);
    t.ok(`perfil: ${p.domain} isJavaScriptHeavy=${p.isJavaScriptHeavy} totalJobs=${p.totalJobs}`);
    const sel = await c.selectors(r.domain);
    t.ok(`selectors list=[${sel.recommendedSelectors.list.join(', ')}]`);

    t.step('Stats del dominio');
    const stats = await c.domainStats(r.domain);
    t.ok(`recientes=${stats.recentRadiographies} avgLoad=${Math.round(stats.avgLoadTime)}ms browserRate=${stats.browserUsageRate}`);
  },
};
