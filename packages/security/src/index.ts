// @ai-scraper/security — SSRF, allowlist dominios, anti prompt-injection (§37).
// Fuente única (ETAPA 2): commands/crawler/execution-engine deben importar de aquí.
export { assertPublicUrl, isBlockedHost, isPrivateHostsAllowed } from './ssrf';
export { createAllowlist, isAllowedHost, normalizeDomain, type Allowlist } from './allowlist';
