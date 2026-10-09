// @ai-scraper/security — SSRF, allowlist dominios, anti prompt-injection (§37).
// Fuente única (ETAPA 2): commands/crawler/execution-engine deben importar de aquí.
export { assertPublicUrl, assertSafeUrl, safeFetchText, safeDnsLookup, isBlockedHost, isBlockedIp, isPrivateHostsAllowed } from './ssrf';
export type { SafeFetchOptions, SafeFetchResult } from './ssrf';
export { createAllowlist, isAllowedHost, normalizeDomain, type Allowlist } from './allowlist';
export { encryptJson, decryptJson, hasCredentialsKey } from './crypto';
