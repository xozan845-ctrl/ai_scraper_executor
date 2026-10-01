// @ai-scraper/security — SSRF, allowlist dominios, anti prompt-injection (§37).
export function isBlockedHost(hostname: string): boolean {
  const blocked = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '169.254.169.254'];
  if (blocked.includes(hostname)) return true;
  if (/^10\./.test(hostname) || /^192\.168\./.test(hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
  return false;
}
