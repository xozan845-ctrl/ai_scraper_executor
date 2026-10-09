# 01 — SSRF: salir a la red sin convertirse en un proxy hacia la red interna

Aplica a: [`../../../libs/shared/security/src/ssrf.ts`](../../../libs/shared/security/src/ssrf.ts),
[`../../../libs/shared/security/src/allowlist.ts`](../../../libs/shared/security/src/allowlist.ts) y
a **todo** punto del repo que vaya a salir a la red.

> **Riesgo propio de este producto:** un scraper recibe una URL del usuario y la pide
> desde dentro de la red del servidor. Sin control, `POST /api/v1/jobs {"url":"http://169.254.169.254/"}`
> devuelve los metadatos del proveedor cloud, y `http://127.0.0.1:5432` las credenciales
> de Postgres. Es el riesgo #1 del repo.

## Reglas

| ID | Regla |
|---|---|
| R-SE-1 | **`@ai-scraper/shared-security` es la fuente única de validación de URL**: toda salida a un host externo pasa por `assertPublicUrl` (síncrono), `assertSafeUrl` (resuelve DNS) o `safeFetchText` (además revalida redirects y limita el tamaño). **Prohibido** hacer `fetch`, `axios`, `got` o el `page.goto` de Playwright contra una URL sin haber pasado antes por `assertPublicUrl`/`assertSafeUrl`. No se reimplementa la lógica de SSRF en otro package: se importa. |
| R-SE-2 | **Bloqueadas loopback, privadas, link-local, CGNAT, ULA e IPv4-mapped**: `isBlockedHost`/`isBlockedIp` cubren `127.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16` (metadata), `100.64/10` (CGNAT), `0.0.0.0/8`, `::1`, `::`, `fc00::/7` (ULA), `fe80::/10` (link-local), las formas IPv4-mapped punteada y hexadecimal (`::ffff:a.b.c.d` y `::ffff:xxxx:xxxx`), y los nombres `localhost` y `metadata.google.internal`. **Añadir un rango a esta función exige su test con el caso exacto** (no con un caso "parecido") en `tests/security.test.mjs`. |
| R-SE-3 | **`assertSafeUrl` cuando el host es un nombre, no una IP literal**: la comprobación por string (`assertPublicUrl`) es la rápida y barata, y es la que se usa en el camino validado; la que resuelve DNS (`assertSafeUrl`) es la que evita que `mi-sitio.example` resuelva a `127.0.0.1`. Las dos se necesitan: string para la validación inmediata, DNS antes de **conectar**. Un nombre que no resuelve o que no devuelve registros es un error, no un permiso. |
| R-SE-4 | **`safeFetchText` revalida cada salto de redirect**: los redirects se siguen a mano (`redirect: 'manual'`) y **cada** URL intermedia se vuelve a pasar por `assertSafeUrl`. No se delega el seguimiento de redirects al cliente HTTP, porque un `302` a `http://169.254.169.254/` sería la puerta trasera del SSRF. Además: `maxRedirects` (5 por defecto) y cuerpo máximo (`maxBytes`, 2 MB por defecto), con el tamaño comprobado **tanto** por `content-length` como sobre el texto ya leído. |
| R-SE-5 | **`ALLOWED_DOMAINS` es la allowlist de negocio, y es opcional**: con `ALLOWED_DOMAINS=tienda.com,otro.com` se rechazan los jobs cuyo host no esté en la lista; **vacío significa "todos permitidos"**, que es el valor por defecto en desarrollo. Un despliegue en producción con la allowlist vacía es una decisión consciente que debe constar en el ADR y en la configuración del entorno (`R-CD-11`); no es el default que se hereda sin querer. La comparación de dominios pasa por `normalizeDomain` / `isAllowedHost` para que `www.` y las mayúsculas no sorteen la lista. |
| R-SE-6 | **`ALLOW_PRIVATE_HOSTS=1` es un bypass solo de pruebas y desarrollo**: habilita `localhost`/ips privadas **solo** si `NODE_ENV !== 'production'` (condición dentro de `isPrivateHostsAllowed`, no en el llamante). En producción la variable no hace nada aunque esté puesta. Los tests que necesitan un host local la usan así, y por eso llevan `ALLOW_PRIVATE_HOSTS=1` en su entorno; ningún test de producción puede depender del bypass. |
| R-SE-7 | **El bypass local no desactiva el resto de guardas**: con `ALLOW_PRIVATE_HOSTS=1` se salta la comprobación de IP, y **solo** esa. Siguen activos el límite de tamaño de cuerpo, el timeout, el número máximo de redirects y la normalización de credenciales. Un bypass que abre todo el paquete es peor que no tener bypass. |
| R-SE-8 | **Toda URL que el motor planifique y extraiga vuelve a validarse al saltar de fase**: el motor revalida el host antes de cada navegación y de cada extracción, no confía en que "ya se validó al crear el job". Es lo que hace que un perfil aprendido de MongoDB (`SiteProfile`) no pueda redirigir el crawler (`R-AI-16`) → `R-AI-5`. |

## Verificación

```bash
# Ningún fetch directo a una URL sin pasar por el módulo
grep -rn "fetch(" apps packages --include=*.ts | grep -v "safeFetchText\|libs/shared/security"

# La condición de producción está dentro del módulo, no en el llamante
grep -n "NODE_ENV !== 'production'" libs/shared/security/src/ssrf.ts

# El bypass está activo solo en pruebas
grep -rn "ALLOW_PRIVATE_HOSTS" tests/*.test.mjs | head
```
