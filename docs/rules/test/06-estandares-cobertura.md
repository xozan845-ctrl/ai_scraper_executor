# 06 — Estándares de Cobertura y Gates

Dos cosas en un solo archivo porque en este repo son la misma: **qué capas debe
tocar cada tipo de cambio** y **qué pasos bloquean el merge hoy**.

> ## Realidad del repo (leer antes que las tablas)
>
> | | Estado real (verificado contra `.github/workflows/ci.yml` y `package.json`) |
> |---|---|
> | Workflow | [`ci.yml`](../../../.github/workflows/ci.yml) con **2 jobs** (`build-test-lint` + `integration`) y [`e2e.yml`](../../../.github/workflows/e2e.yml) de release |
> | Node | 22 en CI (`.nvmrc` y el `engines` del repo piden `>=22`); trae cobertura nativa |
> | Instalación | `npm ci --ignore-scripts` (sin `--legacy-peer-deps` desde Nest 12, ADR-18) |
> | Pasos | `npm ci` → `Security audit` → `prisma:generate` → schema/deriva → `build` → OpenAPI → `lint` → `test` → contract → artifact |
> | Suite | `npm test` = `node --test --test-concurrency=1 --experimental-test-coverage …` sobre 27 ficheros, con `MONGODB_MOCK: '1'` |
> | Cobertura | **Nativa de Node** (`--experimental-test-coverage`): sin `c8` ni `nyc`. Umbrales en el propio script `test`: **70 % líneas / 72 % ramas / 67 % funciones** |
> | Jobs | `build-test-lint` (unit, cobertura, lint, build, contrato, OpenAPI) + `integration` (Postgres/Mongo/Redis) + [`e2e.yml`](../../../.github/workflows/e2e.yml) (release) |
>
> Las tablas siguientes **norman**; la columna de estado dice qué está realmente
> configurado. Un gate ⏸ es una regla vigente con el paso pendiente, y su deuda vive
> en [`README.md`](./README.md). El umbral de cobertura no es inventado: es el
> **baseline medido** (71.59 / 73.69 / 68.90) redondeado a la baja con 1 punto de
> margen (`R-COV-5`).

## Matriz de capas obligatorias por tipo de cambio

Todo cambio debe cubrir las columnas marcadas con ✅. Donde no haya suite para esa
columna, la cobertura del requisito cae en la columna disponible y la capa ausente
queda como deuda (no como permiso para no probar).

| Tipo de cambio | Unit (`node --test`) | Integración (API + BD real) | Contrato (forma de `/api/v1`) | E2E real |
|---|---|---|---|---|
| Helper puro (`util/`, `normalize*`, `clampCommandLimits`) | ✅ | — | — | — |
| Regla de negocio (`validator`, `limits`, `JobStatus`, radiografía) | ✅ | ✅ 1 flujo que la ejercite | — | — |
| Comando del DSL o schema Zod | ✅ (esquema + normalizador) | ✅ si altera un plan guardado | ✅ si cambia el payload | — |
| Endpoint nuevo o con cambio de filtros/paginación | ✅ (servicio) | ✅ (filtros exactos, auth, errores) | ✅ (DTO + Swagger) | — |
| Endpoint con cambio de shape | ✅ | ✅ | ✅ (schema y cliente `scripts/` al día) | — |
| Scraping de una página (selectores, motor, caché) | ✅ con HTML en memoria | — | ✅ si cambia `Result` | ✅ (`tests/e2e-sevasa.test.mjs`) |
| Prompt / modelo / presupuesto de IA | ✅ (con proveedor falso) | — | ✅ si cambia el consumo expuesto | ✅ obligatorio (es la capa que de verdad lo detecta) |
| Política de SSRF o de credenciales | ✅ **obligatorio** (`tests/security.test.mjs`, `browser-ssrf.test.mjs`) | ✅ | ✅ si cambia un header o un status | — |
| Límites, quotas o rate limit | ✅ en sus extremos | ✅ contra Redis real | ✅ si cambia `limits` | — |
| Migración Prisma | — | ✅ (up + down sobre BD real) | ✅ si cambia un DTO | — |
| **Bug en producción** | ✅ regresión primero (`R-REG-1`) | ✅ si es de integración/filtros | ✅ si el cliente lo veía | ✅ si es flujo visible |
| Despliegue / CI / Docker | ✅ si toca código | — | — | — |

Dos filas que en este repo tienen recorrido peculiar:

- **Fila "IA"**: un cambio de prompt **no** se puede validar solo con el proveedor
  falso (`R-FL-4` lo prohíbe en la suite unitaria). El cambio necesita E2E contra el
  LLM real para saber si el modelo sigue emitiendo el DSL esperado. Ese es el motivo
  por el que el E2E es gate de release y no de cada PR (`G-6`).
- **Fila "SSRF"**: `packages/security` no depende de nada, así que su suite es
  puramente unitaria y rápida. Es la capa con más obligaciones y la que no puede
  esperar a que exista la infraestructura.

## Cobertura: qué se mide y qué no

| ID | Regla |
|---|---|
| R-COV-1 | **Ningún cambio puede reducir la cobertura** respecto a la rama base. La comparación es de informes entre bases, nunca de un número absoluto. |
| R-COV-2 | **La lógica nueva entra con su test** en el mismo cambio (`R-U-17`). Los ficheros con lógica ejecutable sin pareja en `tests/` se listan en la auditoría; el bloqueo efectivo es `G-3`. |
| R-COV-3 | **La auditoría se actualiza en cada release** con el estado real: cobertura medida, nº de tests por capa, deudas abiertas, estado de los gates. Un gate solo pasa a ✅ con la evidencia de un **run verde de CI**; tener el paso escrito en un YAML o pasarlo en local no basta. |
| R-COV-4 | **Alcance del gate**: solo lógica ejecutable. En este repo los tests importan el **build** (`packages/*/dist`, `apps/*/dist`), así que la cobertura mide sobre `dist` — transpile 1:1 de `src` por `tsc` — mediante `--test-coverage-include="packages/*/dist/**/*.js"` y `--test-coverage-include="apps/*/dist/**/*.js"`. Se excluyen `**/*.module.js` (wiring de DI), `**/main.js` (bootstrap) y `**/dto/**` (formas sin comportamiento). Nota honesta: Node solo reporta los ficheros **cargados** por la suite; un fichero que nadie importa no cuenta (lo cubre `R-COV-2`, no este gate). |
| R-COV-5 | **Umbral de partida y ratchet**: el umbral inicial es el baseline **medido** con el alcance de `R-COV-4`, redondeado a la baja con 1 punto de margen (nunca un 80 % inventado). Baseline de la 1ª medición: **71.59 % líneas / 73.69 % ramas / 68.90 % funciones** → umbral **70 / 72 / 67**, fijado en el script `test` de `package.json`. A partir de ahí el ratchet **solo sube**: +5 puntos por release, nunca por debajo del último valor registrado. Cada subida queda anotada en `AUDIT.md` (`R-COV-3`). |
| R-COV-6 | **Anti-inflado**: subir cobertura añadiendo asserts triviales está prohibido. El criterio de calidad de un test es que detecte un defecto real: mutación (`R-MT-*`) o, mientras no exista herramienta, asertar contra el requisito y no contra la implementación actual (`R0`). |

> Los heredados `R-COV-1..5` conservan su número y su sentido (umbral, alcance,
> ratchet, anti-inflado). `R-COV-6` es nuevo: recoge explícitamente la tentación de
> la cobertura comprada que en este repo amenaza con más fuerza que en otros, porque
> un mock generoso puede "cubrir" el agent loop entero sin comprobar una sola emisión
> real del modelo.

## Gates

Estado verificado contra `.github/workflows/` (`ci.yml` + `e2e.yml`).
✅ = el job/workflow ejecuta el paso y bloquea · ⏸ = la regla está vigente pero el paso
no existe (deuda) · N/A = no aplica a este repo, **ID reservado, nunca se reutiliza**.

| Gate | Condición | Cómo se ejecutaría | Estado |
|---|---|---|---|
| **G-1** | Suite unitaria completa en verde (100 %) | paso `Test` del job `build-test-lint`: `npm test` con `MONGODB_MOCK=1` | ✅ |
| **G-2** | Suite unitaria de frontend en verde | — | **N/A** — no hay frontend en el monorepo; ID reservado |
| **G-3** | Cobertura ≥ umbral vigente (70 / 72 / 67) | el propio `npm test` (`--experimental-test-coverage` + `--test-coverage-lines/branches/functions`); Node falla el run si no se alcanza | ✅ |
| **G-4** | Suite de integración (API + Postgres/Mongo/Redis reales) en verde | job `integration` de `ci.yml` con servicios efímeros: `npm run test:integration` | ✅ |
| **G-5** | Tests de contrato en verde | paso `Contract` de `ci.yml`: `npm run test:contract` (arranca la API y valida formas de `/api/v1/**`) | ✅ |
| **G-6** | E2E de flujos críticos en verde **antes de release** (no en cada PR) | workflow [`e2e.yml`](../../../.github/workflows/e2e.yml) (`release`/`workflow_dispatch`): `npm run test:e2e` con servicios reales + Chromium + `OPENROUTER_API_KEY` | ✅ |
| **G-7** | **Lint y build sin errores** | pasos `Build` (`npm run build`) y `Lint` (`npm run lint`, ESLint sobre `apps`, `packages` y `scripts`) del mismo job | ✅ |
| **G-8** | Swagger sincronizado | `npm run openapi:check` (exporta `docs/openapi.json` desde la API y compara) | ✅ |
| **G-9** | Deriva de migraciones = 0 | `prisma validate` + `prisma migrate deploy` sobre Postgres efímero + `prisma migrate diff --from-url … --to-schema-datamodel … --exit-code` | ✅ |

Sobre `G-9`: el job valida el schema (`prisma validate`), aplica las migraciones
versionadas sobre un Postgres efímero (`prisma migrate deploy`) y compara el esquema
resultante con `schema.prisma` (`prisma migrate diff --exit-code`). Un modelo cambiado
sin su migración produce un diff no vacío y **falla el job** (exit 2). El Postgres del
job es efímero y se descarta; la BD de desarrollo nunca se toca (`R-EN-2`).

## Qué NO es un gate

- **`npm audit`** es la puerta de seguridad y **ya es un paso del job** `build-test-lint`
  (`Security audit`), no un `G-*`: se norma en
  [`07-qa-gates.md`](./07-qa-gates.md) (`R-QA-6`) y también en
  [`../security/`](../security/README.md) (`R-SE-16`). `npm audit` sale en **0
  vulnerabilidades** (high y moderate).
- **La suite de `npm run test:api`** (cliente real contra la API levantada) no es un
  gate: es un smoke de flujos que hoy se ejecuta a mano.
- **El smoke de Prisma en `npm test`** se autoexcluye si `DATABASE_URL` no responde.
  Es intencionado (permite correr la suite sin Docker) y significa que `G-1` no
  cubre la conexión real: eso es `G-4`.

## Orden de activación recomendado

1. ✅ Cobertura con la herramienta nativa de Node y umbral del baseline (`G-3`).
2. ✅ Schema validado y deriva de migraciones detectada con Postgres efímero (`G-9`).
3. ✅ Spec OpenAPI versionada y verificada en cada run (`G-8`).
4. ✅ Job `integration` con Postgres/Mongo/Redis efímeros (`G-4`).
5. ✅ Contrato de la API (`G-5`) y E2E como workflow de **release** (`G-6`).

## Verificación

```bash
# Lo que bloquea el merge (G-1 + G-3 + G-5 + G-7 + G-8), tal cual lo corre CI
MONGODB_MOCK=1 npm test      # incluye cobertura nativa y falla si baja del umbral
npm run lint
npm run build
npm run openapi:check        # falla si docs/openapi.json no coincide con la API
npm run test:contract        # arranca la API y valida las formas de /api/v1/**

# G-4: integración con almacenes reales (requiere Docker)
docker compose up -d postgres mongodb redis
npm run prisma:migrate:deploy
DATABASE_URL='postgresql://scraper:scraper@localhost:5432/scraper?schema=public' \
MONGODB_URI='mongodb://localhost:27017/scraper' REDIS_URL='redis://localhost:6379' \
  npm run test:integration

# G-6: E2E real (release; requiere Chromium + OPENROUTER_API_KEY)
npm run test:e2e

# Cobertura sola, con el reporte por fichero
MONGODB_MOCK=1 npm test 2>&1 | sed -n '/start of coverage report/,/end of coverage report/p'

# Ejemplo mínimo (un fichero) para ver el mecanismo de umbral
node --test --test-concurrency=1 --experimental-test-coverage \
  --test-coverage-lines=99 --test-coverage-include='packages/*/dist/**/*.js' \
  tests/dsl.test.mjs      # debe fallar: exit 1 + "does not meet threshold"

# G-9: validez del schema y deriva
npx prisma validate --schema=prisma/schema.prisma
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code

# Suites que existen pero no son gates
npm run test:api:fast
npm run test:e2e
```
