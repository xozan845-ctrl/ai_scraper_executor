# CHECKLIST — Revisión de PR

> Resumen ejecutable de [`rules/test/`](../test/README.md), [`rules/git/`](../git/README.md),
> [`rules/ci/`](../ci/README.md) y [`rules/cd/`](../cd/README.md). Copiar en la
> descripción del PR y marcar. Cada ítem remite a su regla; el detalle está en el
> archivo que indique el Mapa de IDs de su README. Las áreas doradas
> ([`architecture/`](../architecture/README.md), [`ai/`](../ai/README.md),
> [`security/`](../security/README.md), [`scraping/`](../scraping/README.md),
> [`data/`](../data/README.md), [`db/`](../db/README.md),
> [`observability/`](../observability/README.md)) se revisan con sus propios IDs
> cuando el PR las toca.

## 1. Tipo de cambio → capas obligatorias

Matriz completa en [`06-estandares-cobertura.md`](../test/06-estandares-cobertura.md).
Marcar las capas ✅ que apliquen y **justificar las que no**.

| Tipo de cambio | Unit | Integración | Contrato | E2E |
|---|---|---|---|---|
| Helper puro (`util/`, `normalize*`, límites) | ✅ | — | — | — |
| Regla de negocio (validator, límites, radiografía) | ✅ | ✅ 1 flujo | — | — |
| Comando del DSL o schema Zod | ✅ | ✅ si altera un plan guardado | ✅ si cambia el payload | — |
| Endpoint nuevo o con filtros/paginación | ✅ | ✅ | ✅ | — |
| Endpoint con cambio de shape | ✅ | ✅ | ✅ | — |
| Scraping (selectores, motor, caché) | ✅ con HTML en memoria | — | ✅ si cambia `Result` | ✅ |
| Prompt / modelo / presupuesto IA | ✅ con proveedor falso | — | ✅ | ✅ **obligatorio** |
| **SSRF o credenciales** | ✅ **obligatorio** | ✅ | ✅ | — |
| Límites, quotas, rate limit | ✅ extremos | ✅ Redis real | ✅ | — |
| Migración Prisma | — | ✅ up + down | ✅ si cambia DTO | — |
| **Bug en producción** | ✅ regresión primero | ✅ si aplica | ✅ si aplica | ✅ si es flujo visible |

> Sin herramientas de cobertura (`G-3` ⏸), la evidencia de la columna Unit es el
> recuento de tests del PR (`MONGODB_MOCK=1 npm test`).

## 2. Universales (todo PR)

- [ ] **R0** — El test aserta el requisito, no la implementación (nada de "actualizar el expected para que pase").
- [ ] **R-QA-2** — Nada de red, BD real ni LLM en `npm test`: todo doblado.
- [ ] **R-FL-4/5** — Suite serial (`--test-concurrency=1`) a propósito; sin `sleep` arbitrario.
- [ ] **R-GC-5** — `npm run build && npm run lint && MONGODB_MOCK=1 npm test` en verde **antes** del commit.
- [ ] **G-7** — Build y lint sin errores (0 errores; los warnings de `no-explicit-any` no bloquean).

## 3. Unit ([`01-reglas-unit.md`](../test/01-reglas-unit.md))

- [ ] **R-U-4** — El test puede fallar (sin asserts triviales; ver `R-COV-6`).
- [ ] **R-U-5/6** — Fechas ISO 8601 UTC con `Z`; los límites se prueban en sus extremos.
- [ ] **R-RB-2** — `limits` en 0, negativos, `NaN`, por encima de `HARD_LIMITS`, y `maxAiTokens: 0` (que **no** desactiva).
- [ ] **R-RB-1** — La salida del LLM se prueba con JSON roto, `type` inventado, campos de más, números como strings.
- [ ] **R-REG-1** — Si es bug: primero el test que falla, luego la fix; marcado `regression: <ref>`.
- [ ] **R-REG-3** — ¿Faltaba una capa superior (integración/E2E) que lo hubiera detectado?

## 4. Seguridad ([`security/`](../security/README.md)) — si el PR toca SSRF, auth o credenciales

- [ ] **R-SE-1..8** — Toda URL pasa por `assertPublicUrl`; redirects y subrecursos del navegador bloqueados igual; test en `tests/security.test.mjs` / `tests/browser-ssrf.test.mjs`.
- [ ] **R-SE-9/10** — Fail-closed sin `API_KEYS` en producción; `x-api-key` con `timingSafeEqual`; el `401` no dice cuál falló.
- [ ] **R-SE-11/12/13** — Credenciales cifradas con AES-256-GCM, nunca devueltas, aplicadas solo en HTTP y navegador.
- [ ] **R-SE-17** — `.env` sigue en `.gitignore` **y** `.dockerignore`; nada de secretos versionados.
- [ ] **R-QA-6** — `npm audit --audit-level=high` sale en 0 (es paso de CI). Si el PR toca dependencias, adjuntar el resultado; el residuo moderate conocido (`@nestjs/core`) está declarado en [`AUDIT.md`](./AUDIT.md).

## 5. IA y DSL ([`ai/`](../ai/README.md)) — si el PR toca planes, prompts o modelos

- [ ] **R-AI-1..3** — Solo los 15 comandos del DSL; el plan se valida con Zod tras `normalize`.
- [ ] **R-AI-7** — El límite efectivo de un comando nunca supera el del job (`clampCommandLimits`).
- [ ] **R-AI-13/14** — Un LLM caído abre el circuit breaker y el job **termina**; no queda colgado.
- [ ] **R-AI-15/16** — Se cita el ID de modelo; el fallback de modelo solo salta en 404/429.

## 6. Scraping y trazabilidad ([`scraping/`](../scraping/README.md))

- [ ] **R-SC-10..16** — Cada item extraído lleva `_source { url, selector, scrapedAt }`; los errores de página se registran con su motivo; `POST /api/v1/jobs/:id/retry` limpia artefactos y no duplica.

## 7. Contrato ([`04-reglas-contrato.md`](../test/04-reglas-contrato.md)) — si el PR toca un endpoint

- [ ] **R-C-1/2** — Todo cuelga de `/api/v1`; el endpoint se declara en Swagger desde su DTO.
- [ ] **R-C-4/5** — La respuesta sale de un DTO (nunca de la fila cruda) y su forma es estable (lista vacía = `[]`).
- [ ] **R-C-7/8** — Fechas ISO 8601 UTC con `Z`; la semántica de `maxRuntimeSec` y `maxAiTokens: 0` está documentada.
- [ ] **R-C-11** — Campo nuevo ⇒ DTO + Swagger + test de forma + quien lo consume, en el mismo cambio.
- [ ] **R-DS-4** — El payload tiene DTO con `class-validator` (el `ValidationPipe` global recorta campos extra).

## 8. Capas sin suite hoy — se declaran, no se inventan

> Integración (`G-4`), contrato (`G-5`) y E2E (`G-6`) **no son checks**. Si el PR toca esas capas, el cuerpo dice qué se ejecutó a mano.

- [ ] **R-I-1..13** — Si toca integración: BD real, datos limpios, filtros exactos, `401/400/404/409` comprobados.
- [ ] **R-C-12** — Si toca un endpoint crítico: su aserción de forma está en el fichero de test que le corresponde.
- [ ] **R-E-1..13** — Si toca el scraping de verdad: `npm run test:e2e` o `npm run test:api:fast` ejecutado y adjunto, con `TEST_URL` como objetivo.

## 9. Antes de mergear (CI)

- [ ] **G-1** suite unitaria (`npm test` con `MONGODB_MOCK=1`) ✅
- [ ] **G-2** unit frontend — **N/A** (sin frontend; ID reservado, nunca reutilizar)
- [ ] **G-3** cobertura ≥ 70 / 72 / 67 (líneas/ramas/funciones) — el propio `npm test` falla si baja
- [ ] **G-4** integración — ⏸ sin suite
- [ ] **G-5** contrato — ⏸ sin suite
- [ ] **G-6** E2E — ⏸ sin job; manual antes de release
- [ ] **G-7** lint + build ✅
- [ ] **G-8** Swagger export — ⏸ sin spec versionada
- [ ] **G-9** deriva de migraciones — ✅ (`prisma validate` + `migrate deploy` + `migrate diff --exit-code`); si el PR toca `schema.prisma`, `prisma/migrations/` trae la migración

## 10. Git ([`rules/git/`](../git/README.md))

- [ ] **R-GA-1/2/3** — Stage con rutas explícitas, revisado con `git diff --cached --stat`: solo archivos del cambio.
- [ ] **R-GA-4/5** — Sin artefactos ni secretos; sin `git add -f` sobre ignorados.
- [ ] **R-GC-1/2/3/4** — Conventional Commits en español e imperativo; una unidad temática; ID de regla citado si aplica.
- [ ] **R-GC-5** — Verificación del repo en verde antes del commit.
- [ ] **R-GC-7 / R-GP-3** — Sin `--amend`/rebase de commits publicados; **sin force** (la historia es lineal: 0 merges).
- [ ] **R-GP-1/5/7** — `git log origin/main..HEAD` leído: solo commits propios y los previstos; `pull --rebase` si divergió.
- [ ] **R-GP-2/6 / R-CI-6** — CI verde **en el run de mi commit**, comprobado con `gh run list` / `gh run view` (nunca "el anterior estaba verde").
- [ ] **R-GE-1/4** — Rama corta desde `main`; nada commiteado directo a `main`.

## 11. PR ([`04-pr.md`](../git/04-pr.md))

- [ ] **R-PR-1** — Rama `tipo/ámbito-descripción` desde `main` actualizado; `main` intacta.
- [ ] **R-PR-2** — Un solo tema; si el cuerpo dice "y además", se parte en dos.
- [ ] **R-PR-3** — Verificación en verde antes de abrir; `[WIP]` en el título si se abre en rojo, y no se mergea así.
- [ ] **R-PR-4** — Cuerpo con este checklist marcado y la **tabla de verificaciones ejecutadas** (comando + resultado).
- [ ] **R-PR-6** — `gh pr checks <n>` en verde **sobre el SHA de la cabeza**.
- [ ] **R-PR-7** — Merge por `--rebase`; sin `--squash` ni merge commit.
- [ ] **R-PR-8** — Tras el merge, run de `ci.yml` en `completed success` **sobre el SHA nuevo de `main`**.
- [ ] **R-PR-9** — Rama eliminada en local y en `origin` al cerrar.

## 12. CI/CD — si el PR toca `.github/`, `docker-compose.yml` o un `Dockerfile`

- [ ] **R-CI-1/2/3/4/5** — Cambiar gatillos, concurrencia, filtrado o añadir workflow, es enmienda explícita de la regla, no edición silenciosa del YAML; los comandos del workflow son verificables en local.
- [ ] **R-EN-1** — Node fijo (`"22"`) y `npm ci --ignore-scripts --legacy-peer-deps` intactos.
- [ ] **R-EN-4** — Secretos solo en GitHub Secrets, nunca impresos.
- [ ] **R-CD-9/10** — El grafo de arranque se respeta: `migrate` one-shot con `migrate deploy` bloquea a `api`/`worker`; no se arranca la API saltándoselo.
- [ ] **R-CD-7/11** — Cero secretos en la imagen (ni `ARG` ni `ENV`); los secretos llegan en runtime por `env_file`/`environment`.
- [ ] **R-CD-12** — Smoke tras la entrega: `/api/v1/health` y `/api/v1/health/ready` en verde; si se revertiría, se revierte por commit, nunca por migración.

> Estado actual de los gates y deudas: [`AUDIT.md`](./AUDIT.md) (snapshot).
