# 02 — Acceso: autenticación, credenciales, CORS, rate limit y secretos

Aplica a: [`../../../apps/api/src/jobs/api-key.guard.ts`](../../../apps/api/src/jobs/api-key.guard.ts),
[`../../../apps/api/src/jobs/rate-limit.guard.ts`](../../../apps/api/src/jobs/rate-limit.guard.ts),
[`../../../apps/api/src/main.ts`](../../../apps/api/src/main.ts),
[`../../../packages/security/src/crypto.ts`](../../../packages/security/src/crypto.ts) y a la
gestión de secretos de todo el repo.

## Reglas

| ID | Regla |
|---|---|
| R-SE-9 | **Autenticación fail-closed, siempre**: la API key se valida por el guard y **en `NODE_ENV=production` sin `API_KEYS` configuradas, todas las rutas protegidas responden `401`**. No hay un modo "abierto porque forgot de configurar": la ausencia de configuración en producción es un cierre, no una excepción. El arranque emite un `error` explícito diciendo que la autenticación está cerrada, para que el operador no descubra el problema en el primer `curl`. |
| R-SE-10 | **La API key viaja solo por header `x-api-key` y se compara en tiempo constante**: nunca por query string (queda en logs, `Referer` e historial) ni por cookie. Hay **dos fuentes** aceptadas, en este orden: (1) `API_KEYS` del entorno, lista separada por comas, comparada con `timingSafeEqual` (y con longitudes distintas que fallan sin comparar); (2) claves de usuario registradas en base de datos, guardadas **hasheadas** (SHA-256) y verificadas por `UserService` — es lo que permite que la clave devuelta por el registro del primer usuario autentique. El cuerpo del `401` **no** dice cuál de las claves falló, y si la base de datos no responde al verificar una clave de usuario, el resultado es **no autorizado**, nunca una autorización por fallo. El dashboard SPA pide la clave al usuario y la envía por header, nunca la embebe en la URL. |
| R-SE-11 | **Las credenciales de un sitio se cifran en reposo y no se devuelven nunca**: las cabeceras que el cliente aporta para una web con login (`Session.credentials`: `Authorization`, `Cookie`, …) se cifran con **AES-256-GCM** mediante `CREDENTIALS_KEY` antes de persistirse, y se descifran **solo** en el worker para aplicarlas a la petición HTTP y al contexto del navegador. Ningún endpoint devuelve `credentials` ni su versión cifrada: el `SELECT` del DTO lo excluye. Un test lo verifica (`tests/credentials.test.mjs`). |
| R-SE-12 | **`CREDENTIALS_KEY` es obligatoria si hay credenciales**: sin `CREDENTIALS_KEY` el sistema no cifra y no debe fingir que sí. La ausencia de la variable se detecta y se avisa (`hasCredentialsKey`); una sesión con credenciales sin clave se rechaza al crearse, con un error que lo dice, en vez de almacenar texto plano. La clave vive fuera del repositorio y **no** es la misma entre entornos. |
| R-SE-13 | **Las credenciales se aplican donde toca y no se filtran**: las cabeceras de sesión se aplican a la petición HTTP (`safeFetchText`) y al contexto de Playwright (`context` / `preNavigationHooks`) **y solo ahí**. Nunca se incluyen en la URL, en un `Referer`, en un log ni en la métrica; nunca se copian al crawler compartido de otro job. |
| R-SE-14 | **CORS explícito y cerrado en producción**: `CORS_ORIGINS` con la lista de orígenes reales habilita CORS; sin lista, en producción **no se emite ninguna cabecera CORS** (mismo origen) y en desarrollo/test se deja abierto para el flujo local. Nunca `*` en producción. `TRUST_PROXY` se configura solo si hay LB/proxy delante, porque de él depende el `req.ip` que usa el rate limit. |
| R-SE-15 | **Rate limiting en los puntos que crean coste**: `POST /api/v1/jobs` (y la creación de sesión) están limitados por IP con `RATE_LIMIT_CREATE_PER_MIN` (30 por defecto) y devuelven `429` con las cabeceras `X-RateLimit-*`. El limitador es una ventana deslizante sobre Redis con respaldo en memoria (`RedisRateLimiter`), de forma que el límite es compartido entre réplicas de API y no por proceso. El scraping hacia el sitio objetivo tiene su propio límite (`CRAWLEE_MAX_REQUESTS_PER_MINUTE`), que es cortesía con el tercero y protección del propio crawler. |
| R-SE-16 | **`npm audit` es puerta de CI, no una nota**: el pipeline ejecuta `npm audit --audit-level=high` como paso obligatorio (`Security audit`, dentro del job `build-test-lint`); si hay vulnerabilidades high o críticas sin resolver, el pipeline falla (`R-QA-6`). Hoy este gate **sale en 0** y está configurado; las transitivas vulnerables se fijaron con `overrides` en el `package.json` raíz (ADR-16). Queda **1 moderate** (`@nestjs/core`), que exige subir Nest de major y se declara como deuda en [`../_meta/AUDIT.md`](../_meta/AUDIT.md): no se sube a `moderate` ni se aceptan excepciones para silenciar el paso. |
| R-SE-17 | **Los secretos vienen del entorno y nunca se versionan**: `.env` está en `.gitignore` **y** en `.dockerignore`; lo versionado es `.env.example` (valores de desarrollo, sin secretos) y la plantilla de producción con marcadores. Prohibido commitear una clave real, un dump o un token; si ya se versionó, reescribir la historia, no "arreglarlo después" (→ `R-GA-4`). En CI los secretos viven en GitHub Secrets y no se imprimen en logs (`R-EN-4`). |

## Verificación

```bash
# Fail-closed en producción (R-SE-9)
grep -n "production" apps/api/src/jobs/api-key.guard.ts

# La clave solo por header (R-SE-10)
grep -n "x-api-key" apps/api/src/jobs/api-key.guard.ts

# Credenciales cifradas y nunca devueltas (R-SE-11)
grep -rn "encryptJson\|decryptJson\|hasCredentialsKey" apps packages --include=*.ts | head

# .env ignorado por git y por docker (R-SE-17)
cat .gitignore .dockerignore
```
