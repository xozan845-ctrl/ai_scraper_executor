/**
 * Cliente real de la API (Node ≥20, global fetch) — universal (macOS/Windows/Linux).
 * Config por entorno: API_URL (default http://localhost:3000/api/v1), API_KEY (x-api-key).
 */

export function createClient({ baseUrl, apiKey } = {}) {
  const base = (baseUrl ?? process.env.API_URL ?? 'http://localhost:3000/api/v1').replace(/\/$/, '');
  const key = apiKey ?? process.env.API_KEY;

  async function req(method, path, body, extraHeaders) {
    const headers = { 'content-type': 'application/json', ...(extraHeaders ?? {}) };
    if (key) headers['x-api-key'] = key;
    const url = `${base}/${String(path).replace(/^\//, '')}`;
    const res = await fetch(url, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const detail = typeof data === 'string' ? data : JSON.stringify(data);
      const err = new Error(`HTTP ${res.status} ${method} ${path} :: ${detail}`);
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return data;
  }

  return {
    baseUrl: base,
    hasKey: Boolean(key),
    req,

    // Salud / docs
    health: () => req('GET', 'health'),
    ready: () => req('GET', 'health/ready'),
    openapi: () => req('GET', 'docs-json'),

    // Sesiones (chat)
    createSession: (body) => req('POST', 'sessions', body),
    listSessions: () => req('GET', 'sessions'),
    getSession: (id) => req('GET', `sessions/${id}`),
    sessionStatus: (id) => req('GET', `sessions/${id}/status`),
    sendMessage: (id, instruction) => req('POST', `sessions/${id}/messages`, { instruction }),

    // Jobs
    createJob: (body, idempotencyKey) =>
      req('POST', 'jobs', body, idempotencyKey ? { 'idempotency-key': idempotencyKey } : undefined),
    listJobs: (query = '') => req('GET', `jobs${query}`),
    getJob: (id) => req('GET', `jobs/${id}`),
    jobResults: (id) => req('GET', `jobs/${id}/results`),
    jobExecution: (id) => req('GET', `jobs/${id}/execution`),
    jobAi: (id, limit = 10) => req('GET', `jobs/${id}/ai?limit=${limit}`),
    cancelJob: (id) => req('POST', `jobs/${id}/cancel`),
    retryJob: (id) => req('POST', `jobs/${id}/retry`),

    // Radiografía / memoria
    radiography: (body) => req('POST', 'radiography', body),
    profile: (domain) => req('GET', `radiography/profile/${domain}`),
    selectors: (domain) => req('GET', `radiography/profile/${domain}/selectors`),
    domainStats: (domain) => req('GET', `radiography/domain/${domain}/stats`),

    // Métricas
    metrics: () => req('GET', 'metrics'),
    prometheus: () => req('GET', 'metrics/prometheus'),
  };
}
