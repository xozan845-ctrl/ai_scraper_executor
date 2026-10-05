# Reglas de Seguridad — AI Web Scraping Executor

Reglas del **perímetro**: qué URLs puede tocar el sistema, quién puede llamarlo y
cómo se guardan las credenciales que el usuario aporta para una web con login.

> Este área sustituye a la heredada `gateway/`: este repo no tiene un API Gateway con
> JWT y OAuth, así que las reglas de auth se reescribieron sobre lo que realmente
> protege el sistema: SSRF, `x-api-key`, credenciales cifradas y rate limiting. El
> sufijo `R-GW` queda **retirado** (ver el índice raíz).

## Archivos

| Archivo | Contenido | Sufijo |
|---|---|---|
| `01-ssrf.md` | `assertPublicUrl`/`assertSafeUrl`/`safeFetchText`, allowlist de dominios, `ALLOW_PRIVATE_HOSTS` | `R-SE` (1–8) |
| `02-acceso.md` | `x-api-key` fail-closed, credenciales cifradas AES-256-GCM, CORS y cabeceras, rate limiting, secretos | `R-SE` (9–17) |

> Los documentos derivados de este área (**AUDIT, CHECKLIST, historiales**) no viven
> aquí: están en [`../_meta/`](../_meta/README.md). Un área de reglas solo contiene
> `README.md` + archivos `NN-tema.md`.

## Mapa de IDs

| Prefijo | Rango | Archivo | Ámbito |
|---|---|---|---|
| `R-SE-*` | 1–8 | `01-ssrf.md` | Salir a la red sin convertirse en un proxy hacia la red interna |
| `R-SE-*` | 9–17 | `02-acceso.md` | Autenticación, credenciales, CORS, rate limit y secretos |

## Amenazas que esta área cubre

| Amenaza | Regla que la corta |
|---|---|
| El crawler usado como proxy a `169.254.169.254`, `127.0.0.1` o un host interno | `R-SE-1`, `R-SE-2`, `R-SE-3` |
| Redirect de una URL pública a una privada | `R-SE-4` |
| Escaneo del rango interno del VPS desde fuera | `R-SE-5` (`ALLOWED_DOMAINS`) |
| API abierta por ausencia de configuración | `R-SE-9` (fail-closed) |
| Fuga de la API key en logs o `Referer` | `R-SE-10` |
| Lectura de credenciales del sitio por la API | `R-SE-11`, `R-SE-12` |
| Consumo de coste de LLM o scraping abusivo | `R-SE-15`, `R-SC-7` |

## Reglas de otras áreas que exige esta (cross-refs)

| ID | Exigencia |
|---|---|
| `R-SE-1` | El módulo es la fuente única → el DSL también valida por él: `R-AI-5` (`../ai/01-dsl.md`) |
| `R-SE-4` | Revalidar redirects tiene su coste → el budget de peticiones del job: `R-SC-3` (`../scraping/01-motor.md`) |
| `R-SE-9` | Fail-closed y su test → `R-I-4` (`../test/02-reglas-integracion.md`) |
| `R-SE-12` | Nada cifrado sale por la API → `R-DS-3` (`../data/02-seguridad.md`) |
| `R-SE-16` | El gate de `npm audit` bloquea CI → `R-QA-6` (`../test/07-qa-gates.md`) |

## Pendientes

- El gate de `npm audit --audit-level=high` **ya está en CI y sale en 0**
  (`R-SE-16` / `R-QA-6`); queda 1 moderate de `@nestjs/core` como deuda declarada en
  [`../_meta/AUDIT.md`](../_meta/AUDIT.md).
- La allowlist de dominios (`ALLOWED_DOMAINS`) es opcional y vacío = "todos permitidos".
  En producción, un despliegue abierto es una decisión consciente (`R-SE-5`).
