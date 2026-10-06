# Reglas de DB — AI Web Scraping Executor

Reglas de **almacenamiento** de los tres motores que usa el proyecto, cada uno con un
papel distinto: **Postgres** (verdad transaccional, vía Prisma), **MongoDB** (memoria
y perfiles aprendidos) y **Redis** (cola, caché, rate limit y métricas
distribuidas). Ninguno es un almacén genérico: el error clásico es meter en el
almacén que no le toca.

## Archivos

| Archivo | Contenido | Sufijo |
|---|---|---|
| `01-database.md` | Postgres con Prisma: esquema, migraciones, índices, transacciones, paginación | `R-DB` (1–8) |
| `02-mongodb.md` | MongoDB: conexión, `SiteProfile`, `PageRadiography`, índices TTL, fallback en memoria | `R-MO` (1–6) |
| `03-redis.md` | Redis: cola BullMQ, caché, rate limit, métricas agregadas, fallback en memoria | `R-RD` (1–6) |

> Este archivo `02-supabase.md` (sufijo `R-SB`) queda **eliminado**: este proyecto no
> usa Supabase, ni RLS, ni `auth.uid()`. El sufijo `R-SB` queda **retirado** y nunca
> se reutiliza. Los papers que ocupaba están repartidos entre `01`, `02` y `03`.

> Los documentos derivados de este área (**AUDIT, CHECKLIST, historiales**) no viven
> aquí: están en [`../_meta/`](../_meta/README.md). Un área de reglas solo contiene
> `README.md` + archivos `NN-tema.md`.

## Mapa de IDs

| Prefijo | Rango | Archivo | Ámbito |
|---|---|---|---|
| `R-DB-*` | 1–8 | `01-database.md` | Postgres (Prisma): verdad transaccional |
| `R-MO-*` | 1–6 | `02-mongodb.md` | MongoDB: radiografía y perfiles aprendidos |
| `R-RD-*` | 1–6 | `03-redis.md` | Redis: cola, caché, rate limit, métricas |

## Qué va en cada almacén (y por qué está prohibido mezclarlo)

| Dato | Almacén | Por qué ahí |
|---|---|---|
| `Job`, `Session`, `SessionMessage`, `ScrapingPlan`, `Command`, `Page`, `Result`, `JobError`, `AIInteraction`, `User` | **Postgres** | Relations, integridad referencial, consulta por filtros y orden estable |
| `SiteProfile`, `PageRadiography` | **MongoDB** | Documentos con forma evolutiva (selectores que cambian con el sitio) y TTL natural |
| Cola BullMQ, caché de páginas/LLM, rate limit, contadores agregados | **Redis** | Es estado volátil con TTL y acceso por clave; no necesita consultas relacionales |

La regla que sale de esta tabla: **un `Result` no se guarda en Redis y un perfil
aprendido no se guarda en Postgres**. Si un dato necesita consulta relacional y
referencia a un job, es Postgres; si es un documento que envejece solo, es MongoDB; si
puede expirar sin dejar rastro, es Redis.

## Reglas de otras áreas que exige esta (cross-refs)

| ID | Exigencia |
|---|---|
| `R-DB-6` | Migrar el esquema es un cambio normativo → `R-AR-9` (`../architecture/01-arquitectura.md`) |
| `R-DB-6` | Migraciones solo hacia adelante también en despliegue → `R-CD-5` (`../cd/01-despliegue.md`) |
| `R-MO-3` | El perfil aprendido es caché, no verdad → `R-SC-14` (`../scraping/02-trazabilidad.md`) |
| `R-RD-3` | La caché de Redis tiene TTL → `R-DI-5` (`../data/01-integridad.md`) y `R-SC-5` (`../scraping/01-motor.md`) |
| `R-RD-5` | El fallback en memoria de Redis avisa y degrada → `R-AR-6` (`../architecture/01-arquitectura.md`), `R-DI-6` (`../data/01-integridad.md`) |
| `R-DB-8` | En CI se aplica solo desde migraciones versionadas → `R-EN-2` (`../ci/02-entorno.md`) |

## Estado y pendientes

- **Índices (R-DB-4/R-DB-5): cumplido** desde 2026-10-06. La migración
  `20261006153221_add_composite_indexes` añade índices de FK (`jobId`, `sessionId`,
  `userId`) y de consulta (`Job(status, createdAt)`, `Job(userId, createdAt)`,
  `Session(domain, updatedAt)`). Antes no había ninguno (salvo `User.email`).
- **Retención (R-DI-8): definida** desde 2026-10-06: se conservan `Job`, `Result`,
  `JobError` y las sesiones; se purgan `Page`/`Command`/`AIInteraction` más antiguos que
  `RETENTION_ARTIFACT_DAYS` con `npm run retention:prune`.
- `redis` se usa también como broker de la cola (BullMQ). Compartir el mismo Redis
  para caché y cola significa que un `FLUSHALL` de mantenimiento **tumba los jobs en
  vuelo**. La separación es deuda abierta de `R-RD-1`.
