# @ai-scraper/shared-security

El **perímetro** del sistema: lo que decide a qué host se puede salir y cómo se
guardan los secretos de una sesión. No depende de nada (shared kernel).

- **Capa**: `libs/shared/security` (shared kernel, cross-cutting; lo usan `domain/ai`, `execution-engine`, `crawler`, `mongodb` y las apps).
- **Dependencias**: ninguna (solo `typescript` en desarrollo).
- **Superficie pública**:
  - `assertPublicUrl(url)` — validación **síncrona** por string; rechaza loopback,
    privadas, link-local, CGNAT, ULA, IPv4-mapped y metadata — `R-SE-1`, `R-SE-2`.
  - `assertSafeUrl(url)` — además resuelve DNS antes de conectar — `R-SE-3`.
  - `safeFetchText(url, opts)` — `fetch` con **revalidación de cada redirect**,
    `maxRedirects` y `maxBytes`; es el único camino HTTP a terceros — `R-SE-1`, `R-SE-4`.
  - `isBlockedHost`, `isBlockedIp`, `isPrivateHostsAllowed` — el detalle del bloqueo y
    el bypass de desarrollo (`ALLOW_PRIVATE_HOSTS=1`, solo fuera de producción) — `R-SE-6`.
  - `createAllowlist(jobUrl)`, `isAllowedHost(host, allowed)`, `normalizeDomain(input)`
    — allowlist de negocio por job — `R-SE-5`.
  - `encryptJson`/`decryptJson`/`hasCredentialsKey` — AES-256-GCM de credenciales de
    sesión — `R-SE-11`, `R-SE-12`.

## Comandos

```bash
npm run build -w @ai-scraper/shared-security
node --test tests/security.test.mjs tests/browser-ssrf.test.mjs
```
