# AUDIT — Estado de cumplimiento de `docs/rules/`

> **Snapshot** reescrito completo en cada auditoría (`R-COV-3`): este archivo
> describe el estado **presente** de **este repo**, medido con los comandos del
> final. El histórico de auditorías vive en
> [`AUDIT-HISTORY.md`](./AUDIT-HISTORY.md).

- **Última auditoría:** 2026-10-05 — **1ª auditoría de este repo**, hecha durante
  la reescritura de las reglas contra la realidad medida, y **cerrada el mismo día
  con la puerta de seguridad puesta en verde** (`npm audit --audit-level=high` → 0,
  ya como paso de CI). Todas las cifras de este documento son **medidas**.
- **Estado global:** 🟢 **CUMPLE** para lo que CI puede verificar — la verificación
  de cierre (`npm run build && npm run lint && MONGODB_MOCK=1 npm test`) está verde,
  la **puerta de seguridad ya no bloquea** (high/critical = 0) y quedan como deuda
  declarada las capas que aún no tienen suite (integración, contrato, E2E) y la
  cobertura sin herramienta.

## Números medidos

| Métrica | Valor | Cómo se midió |
|---|---|---|
| Tests unitarios | **149 / 149 en verde, 37 suites** (incluye 6 propiedades de `fast-check`) | `MONGODB_MOCK=1 npm test` |
| Ficheros de test | **28 en disco, 27 en `npm test`** | `ls tests/*.test.mjs` vs script `test` |
| Runner | `node --test --test-concurrency=1` | script `test` de `package.json` |
| Lint | **0 errores, 0 warnings** (alcance `apps`, `packages`, `scripts`) | `npm run lint` |
| Build | **exit 0**, 0 errores TS, 12 paquetes + 2 apps | `npm run build` |
| Puertas de seguridad | **`npm audit --audit-level=high` → exit 0** y **`--audit-level=moderate` → exit 0**: **0 vulnerabilidades** (Nest 12 cerró el moderate de `@nestjs/core`) | `npm audit` |
| Cobertura | **71.59 % líneas / 73.69 % ramas / 68.90 % funciones** (baseline medido); umbral **70 / 72 / 67** | `npm test` (nativo de Node) |
| OpenAPI | **`docs/openapi.json` versionada y verificada** en CI (`npm run openapi:check`) | `G-8` |
| Paquetes | **12** en `packages/` + 2 apps | `ls packages` |
| Ficheros TS de fuente | **87** en `apps/` + `packages/` (sin `dist/`) | `find … -name '*.ts'` |
| Modelos Prisma | **10** (`User`, `Job`, `Session`, `SessionMessage`, `ScrapingPlan`, `Command`, `Page`, `Result`, `JobError`, `AIInteraction`) | `prisma/schema.prisma` |
| Migraciones | **2** (`0_init`, `20261005001125_sessions`) | `ls prisma/migrations` |
| Comandos del DSL | **15** literales Zod | `packages/commands/src/schemas.ts` |
| Git | **1 rama** (`main`), **58 commits, 0 merge commits** | `git branch -a`, `git rev-list` |
| Workflows | **1** (`ci.yml`), **1 job** (`build-test-lint`) | `.github/workflows/` |
| Suites | `npm test` 26 ficheros · `npm run test:e2e` 1 (`tests/e2e-sevasa.test.mjs`) · `npm run test:api` → `scripts/run-all.mjs` | `package.json` |

## Estado por capa

| Capa | Estado | Evidencia |
|---|---|---|
| Unit / integración con dobles | 🟢 | **143 tests / 36 suites** en verde, sin red y sin Docker (`MONGODB_MOCK=1`) |
| Frontend | **N/A** | No hay `frontend/` en el monorepo. `G-2` y `R-COV-5` quedan **reservados, nunca reutilizados** |
| Integración con almacén real | 🔴 | **0 tests** con Postgres/Mongo/Redis reales. Deuda `G-4` (reglas `R-I-*` exigibles cuando toque) |
| Contrato de API | 🔴 | **0 tests** de forma. Deuda `G-5` (`R-C-12`) |
| E2E real | 🔴 | El fichero existe (`tests/e2e-sevasa.test.mjs`) y se ejecuta **a mano** (`npm run test:e2e`); no hay job. Deuda `G-6` |
| OpenAPI | 🟢 | `docs/openapi.json` versionada; `npm run openapi:check` como paso `OpenAPI spec in sync` (`G-8` ✅) |
| Cobertura | 🟢 | **Nativa de Node** (`--experimental-test-coverage`), umbrales 70/72/67 en el script `test`. Baseline medido 71.59/73.69/68.90; `G-3` ✅ |
| Property-based | 🟢 | `fast-check` en `tests/property.test.mjs` (6 propiedades, dentro de `npm test`). Encontró 2 defectos reales (`R-PB-*`) |
| Mutation testing | 🔴 diferido | `R-MT-1`/ADR-20: Stryker 10 no tiene runner para `node --test`; se reevalúa con una suite de runner soportado |
| Lint (`G-7`) | 🟢 | 0 errores, **0 warnings** (incluye `scripts/`) |
| Build (`G-7`) | 🟢 | `npm run build` exit 0 |
| **Security gate** (`R-QA-6`/`R-SE-16`) | 🟢 | **`npm audit` → 0 vulnerabilidades** (high y moderate) y ya es un paso de CI (`Security audit`). Nest 12 + eslint 10 alinearon los peers y retiraron `--legacy-peer-deps` (ADR-18) |
| Artifacts (`R-EN-3`) | 🟢 | `test-results.xml` (reporter JUnit de Node) subido en todos los runs (`if: always()`) |

## Gates

Verificado contra `.github/workflows/ci.yml`.

| Gate | Estado | Evidencia |
|---|---|---|
| `G-1` suite unitaria | ✅ | paso `Test`: `npm test` con `MONGODB_MOCK: '1'` → 143/143 |
| `G-2` unit frontend | **N/A** | sin frontend (ID reservado) |
| `G-3` cobertura | ✅ | `npm test` con `--experimental-test-coverage` + `--test-coverage-lines=70 --test-coverage-branches=72 --test-coverage-functions=67`; baseline 71.59/73.69/68.90 |
| `G-4` integración | ⏸ | sin suite ni servicios efímeros en CI |
| `G-5` contrato | ⏸ | sin suite |
| `G-6` E2E | ⏸ | sin job; `npm run test:e2e` es manual |
| `G-7` lint + build | ✅ | pasos `Build` y `Lint` del mismo job |
| `G-8` Swagger sync | ✅ | paso `OpenAPI spec in sync`: `npm run openapi:check` sobre `docs/openapi.json` |
| `G-9` deriva de migraciones | ✅ | `prisma validate` + `prisma migrate deploy` + `prisma migrate diff --exit-code` sobre Postgres efímero |

**Total: 5 ✅ · 1 N/A · 3 ⏸.**

Controles que **no** llevan ID `G-*` (pero pueden bloquear igual): la puerta de
seguridad es un **paso del job** y se norma como `R-QA-6`/`R-SE-16`, no como gate
`G-n`; el cliente real de la API (`npm run test:api`) y el smoke de Prisma que se
autoexcluye en `npm test` si `DATABASE_URL` no responde no bloquean.

## Deudas abiertas (orden de ataque)

1. **Capas de test enteras sin suite**: integración (`G-4`), contrato (`G-5`) y
   E2E como gate de release (`G-6`).
2. **Sin protección de rama en el remoto (bloqueada por el plan)**: el intento de
   aplicarla con `gh api` devuelve `403 Upgrade to GitHub Pro or make this repository
   public` — es una función de pago en repos privados, no deuda de este repo. Hasta
   activar Pro o hacerlo público, `R-GE-4` se cumple por disciplina (rama + PR +
   merge), no por enforcement.
3. **Promoción entre entornos sin implementar** (`R-GE-5`): una sola rama, un solo
   juego de secretos. Deuda asumida, no norma.
4. **Mutation testing diferido a propósito** (`R-MT-1`, ADR-20), no por descuido:
   Stryker 10 no tiene runner para `node --test` y los tests cargan `dist`; se
   reevalúa cuando exista una suite con runner soportado. Los property tests cubren
   el riesgo mientras tanto.

## Cerradas en esta auditoría

- **Reescritura completa de `docs/rules/`** contra el repo medido: borradas las áreas
  `gateway/` y `microservice/` (no existen aquí) y `db/02-supabase.md` (`R-SB`
  retirado, **nunca reutilizar**); creadas `ai/` y `security/`. Los sufijos `R-GW`,
  `R-MS`, `R-MI` y `R-SB` quedan **retirados**.
- **Snapshot sustituido**: las cifras heredadas (358 tests, 55 suites, 10 workspaces
  con `coverageThreshold`, 47 warnings, 65 PRs, 48 commits, cobertura por
  workspace) eran de otro proyecto. Este documento mide las de este repo.
- **`docs/rules/` estaba sin trackear**: `git status` mostraba `?? docs/`. Sigue
  sin trackear; versionarlo es un commit propio.
- **Puerta de seguridad cerrada y en CI**: `npm audit --audit-level=high` pasó de
  exit 1 (8 high) a **exit 0**, mediante `overrides` en el `package.json` raíz
  (`multer`, `http-cache-semantics`, `deepmerge-ts`, `js-yaml`, `lodash`,
  `body-parser`, `qs`, `file-type`) y se añadió el paso `Security audit` al job
  `build-test-lint`. Las transitivas de Nest no se forzaron a un major nuevo: se
  parchearon dentro de rango. Ese moderate de `@nestjs/core` se cerró después con
  Nest 12 (ADR-18). Ver [`decisiones.md`](../../decisiones.md) (ADR-16).
- **`G-3` (cobertura) activado**: sin añadir dependencias, con la herramienta nativa
  de Node (`--experimental-test-coverage`) y umbrales del baseline medido
  (70 / 72 / 67). El umbral vive en el script `test`, así que `npm test` —y por tanto
  el job `build-test-lint`— falla si la cobertura baja. El alcance es `dist` (lo que
  los tests cargan), documentado en `R-COV-4`. Ver ADR-17.
- **CI endurecida**: `concurrency` con `cancel-in-progress` (`R-CI-2`) y
  **`G-9` cerrado** con un servicio Postgres efímero: `prisma validate` +
  `migrate deploy` + `migrate diff --exit-code` (un cambio de schema sin migración
  falla el job). El servicio es de un solo job (`R-EN-2`) y no toca la BD de
  desarrollo.
- **Nest 10 → 12 y eslint 10**: se alinearon los peers con `@nestjs/mongoose@12`,
  desaparecieron los conflictos, y se retiró `--legacy-peer-deps` de CI y de los
  Dockerfiles (ADR-18). `npm audit` queda en **0 vulnerabilidades**. Nest 12 usa
  Express 5 (a tener en cuenta en rutas nuevas).
- **Runtime de la API adaptado a Nest 12/Express 5**: adaptador `ExpressAdapter`
  explícito (el driver HTTP no se autodetecta cuando `platform-express` está
  anidado) y comodín `*url` en `GET /radiography/page/*url`. Lo detectó el arranque
  manual de la API, no la suite unitaria: refuerza la deuda de `G-4`/`G-6`.
- **Warnings de lint a cero**: `scripts/` entra en el alcance de ESLint (globals de
  Node) y se corrigieron las findings reales (`no-useless-assignment`,
  `preserve-caught-error`) y los `any`/variables sin usar (tipos estructurales).
  Resultado: **0 errores / 0 warnings** (antes 0/20).
- **`G-8` (OpenAPI) y artifact de test**: `docs/openapi.json` versionada y verificada
  con `npm run openapi:check` en CI; el reporter JUnit de Node escribe
  `test-results.xml`, subido como artifact en todos los runs (`R-EN-3`).
- **Property-based testing real** (`R-PB-*`): `fast-check` + `tests/property.test.mjs`
  dentro de `npm test` (149 tests en total). Las propiedades **encontraron dos
  defectos reales** y los dejaron corregidos (`R-REG-1`):
  `normalizeJobLimits(5e-324) → 0` (fuera de `[1, HARD]`, no idempotente) y la
  resolución de alias contra el prototipo (`__proto__`/`constructor`/`_ proto _`).
  La mutación (`R-MT`) queda diferida a propósito (ADR-20).

## Cómo re-auditar

```bash
# La verificación de cierre: la misma que ejecuta el job build-test-lint
npm run build && npm run lint && MONGODB_MOCK=1 npm test

# Puertas de seguridad (R-QA-6): 0 vulnerabilidades
npm audit --audit-level=high
npm audit --audit-level=moderate

# OpenAPI versionada (G-8): falla si docs/openapi.json no coincide con la API
npm run openapi:check
npm run openapi:export   # para actualizarla

# Schema, migraciones y deriva (G-9: lo que corre CI)
npx prisma validate --schema=prisma/schema.prisma
docker compose up -d postgres
DATABASE_URL='postgresql://scraper:scraper@localhost:5432/scraper?schema=public' npx prisma migrate deploy --schema=prisma/schema.prisma
DATABASE_URL='postgresql://scraper:scraper@localhost:5432/scraper?schema=public' npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
docker compose stop postgres

# Cobertura (G-3): el reporte completo por fichero
MONGODB_MOCK=1 npm test 2>&1 | sed -n '/start of coverage report/,/end of coverage report/p'

# Mecanismo de umbral (debe fallar con exit 1)
node --test --test-concurrency=1 --experimental-test-coverage \
  --test-coverage-lines=99 --test-coverage-include='packages/*/dist/**/*.js' tests/dsl.test.mjs

# Estado del repo y del workflow
git branch -a && git rev-list --count main && git rev-list --merges --count main
ls .github/workflows/ && grep -c "jobs:" .github/workflows/ci.yml

# Capas sin gate: se ejecutan a mano
npm run test:api:fast
npm run test:e2e      # requiere Docker + OPENROUTER_API_KEY + Chromium

# Evidencia de CI (R-COV-3: un gate ✅ solo con run verde)
gh run list --limit 5
gh run view <id>
```

Al terminar: **reescribir este snapshot** y **agregar una entrada** al final de
`AUDIT-HISTORY.md` (`R-COV-3`).
