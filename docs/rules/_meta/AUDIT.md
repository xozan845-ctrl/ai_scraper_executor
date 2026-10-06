# AUDIT — Estado de cumplimiento de `docs/rules/`

> **Snapshot** reescrito completo en cada auditoría (`R-COV-3`): este archivo
> describe el estado **presente** de **este repo**, medido con los comandos del
> final. El histórico de auditorías vive en
> [`AUDIT-HISTORY.md`](./AUDIT-HISTORY.md).

- **Última auditoría:** 2026-10-06 — **2ª auditoría**, tras integrar las áreas
  [`documentation/`](../documentation/README.md) (`R-DO`) y
  [`ai-contributions/`](../ai-contributions/README.md) (`R-AC`) y **sincronizar las
  reglas con el remoto**: el trabajo de la 1ª auditoría se publicó por rama + PR #1
  (merge `--rebase`) y `main` quedó con el run **verde** `37361504637`.
- **Estado global:** 🟢 **CUMPLE**. La verificación de cierre está verde, los **9
  gates** tienen run verde de CI (`G-1..G-9`, `G-2` N/A) y `npm audit` está en **0
  vulnerabilidades**. Quedan como deuda declarada: la protección de rama (bloqueada
  por el plan de GitHub), la promoción entre entornos, la mutación (diferida) y los
  `README.md` por paquete/app (`R-DO-1`).

## Números medidos

| Métrica | Valor | Cómo se midió |
|---|---|---|
| Tests unitarios | **153 / 153 en verde, 38 suites** (6 propiedades de `fast-check` + 4 de completitud del DSL) | `MONGODB_MOCK=1 npm test` |
| Ficheros de test | **31 en disco, 28 en `npm test`** | `ls tests/*.test.mjs` vs script `test` |
| Tests de contrato / integración | **8 / 4**, en verde | `npm run test:contract`, `npm run test:integration` |
| Runner | `node --test --test-concurrency=1` | script `test` de `package.json` |
| Lint | **0 errores, 0 warnings** (alcance `apps`, `packages`, `scripts`) | `npm run lint` |
| Build | **exit 0**, 0 errores TS, 12 paquetes + 2 apps | `npm run build` |
| Puertas de seguridad | **`npm audit` → exit 0** (high y moderate): **0 vulnerabilidades** | `npm audit` |
| Cobertura | baseline **71.59 / 73.69 / 68.90**; umbral **70 / 72 / 67**; medido ~73.2/74.8/68.9 | `npm test` (nativo de Node) |
| OpenAPI | **`docs/openapi.json` versionada y verificada** en CI | `G-8` |
| Paquetes | **12** en `packages/` + 2 apps | `ls packages` |
| Modelos Prisma | **10**; migraciones **3** (`0_init`, `sessions`, `add_composite_indexes`) | `prisma/schema.prisma`, `ls prisma/migrations` |
| Comandos del DSL | **15** literales Zod | `packages/commands/src/schemas.ts` |
| Git | **1 rama** (`main`), **68 commits, 0 merge commits**; PR #1 fusionado por `--rebase` | `git branch -a`, `git rev-list` |
| Workflows | **2** (`ci.yml` con 2 jobs + `e2e.yml`) | `.github/workflows/` |

## Estado por capa

| Capa | Estado | Evidencia |
|---|---|---|
| Unit / integración con dobles | 🟢 | **149 tests / 37 suites**, sin red y sin Docker (`MONGODB_MOCK=1`) |
| Frontend | **N/A** | No hay `frontend/`. `G-2` y `R-COV-5` **reservados, nunca reutilizados** |
| Integración con almacén real | 🟢 | `tests/integration.test.mjs` (4 tests, Postgres/Mongo/Redis); job `integration` |
| Contrato de API | 🟢 | `tests/contract.test.mjs` (8 tests); paso `Contract` |
| E2E real | 🟢 | workflow [`e2e.yml`](../../../.github/workflows/e2e.yml) en `release`; necesita Chromium + `OPENROUTER_API_KEY` |
| OpenAPI | 🟢 | `docs/openapi.json` + `npm run openapi:check` |
| Cobertura | 🟢 | nativa de Node, umbrales 70/72/67 en el script `test` |
| Property-based | 🟢 | `fast-check` + `tests/property.test.mjs`; encontró **3 defectos reales** |
| Mutation testing | 🔴 diferido | `R-MT-1`/ADR-20: Stryker 10 no tiene runner para `node --test`. **Reevaluado 2026-10-06** al cerrar `G-4`/`G-5`: sigue diferido (el disparador real es adoptar jest/vitest/tap, que ADR-03 evita) |
| Lint / Build (`G-7`) | 🟢 | 0 errores / 0 warnings; `npm run build` exit 0 |
| Security gate (`R-QA-6`/`R-SE-16`) | 🟢 | `npm audit` → 0 vulnerabilidades; paso `Security audit` |
| Artifacts (`R-EN-3`) | 🟢 | `test-results.xml` (JUnit) subido en todos los runs |
| Documentación (`R-DO`) | 🟢 | área al día; **14/14** `README.md` de paquete/app creados; `.env.production.example` versionada |
| Contribución de IA (`R-AC`) | 🟢 | área creada y adaptada; se cumple por disciplina (PR #1) |

## Gates

Verificado contra `.github/workflows/` (`ci.yml` + `e2e.yml`). Todos con run verde.

| Gate | Estado | Evidencia |
|---|---|---|
| `G-1` suite unitaria | ✅ | paso `Test`: 149/149 |
| `G-2` unit frontend | **N/A** | sin frontend (ID reservado) |
| `G-3` cobertura | ✅ | `--test-coverage-lines=70 --test-coverage-branches=72 --test-coverage-functions=67` |
| `G-4` integración | ✅ | job `integration` (Postgres/Mongo/Redis efímeros) → 4/4 |
| `G-5` contrato | ✅ | paso `Contract` → 8/8 |
| `G-6` E2E | ✅ | workflow `e2e.yml` (release) |
| `G-7` lint + build | ✅ | pasos `Build` y `Lint` |
| `G-8` Swagger sync | ✅ | paso `OpenAPI spec in sync` |
| `G-9` deriva de migraciones | ✅ | `prisma validate` + `migrate deploy` + `migrate diff --exit-code` |

**Total: 8 ✅ · 1 N/A · 0 ⏸.** Evidencia de CI: run `37361504637` sobre `main`
(`d891389`) con ambos jobs en `success`; el PR #1 verificó los checks en su cabeza
(`R-PR-6`) y el run post-merge (`R-PR-8`).

Controles que **no** llevan ID `G-*`: la puerta de seguridad (`R-QA-6`/`R-SE-16`, paso
del job), el cliente real de la API (`npm run test:api`) y el smoke de Prisma que se
autoexcluye en `npm test` si `DATABASE_URL` no responde.

## Deudas abiertas (orden de ataque)

1. **Sin protección de rama en el remoto (bloqueada por el plan)**: `gh api` devuelve
   `403 Upgrade to GitHub Pro or make this repository public` — es un límite del plan
   en repos privados, no deuda del repo. `R-GE-4` se cumple por disciplina (rama + PR).
2. **Promoción entre entornos sin implementar** (`R-GE-5`): una sola rama, un solo
   juego de secretos. Deuda asumida, no norma.
3. **Mutation testing diferido a propósito** (`R-MT-1`, ADR-20): Stryker 10 no tiene
   runner para `node --test` y los tests cargan `dist`. **Reevaluado 2026-10-06** al
   cerrar `G-4`/`G-5`: el disparador «suite con runner soportado» **no** se cumple (el
   runner no cambia); el disparador real es adoptar jest/vitest/tap, que ADR-03 evita.
   Los property tests y la completitud del DSL cubren el riesgo mientras tanto.
4. **`overrides` de transitivas** (ADR-16/ADR-18): **revisado 2026-10-06** y reducido
   de **8 a 1** (`deepmerge-ts: ^8.0.0`). Los otros siete (`multer`, `qs`,
   `body-parser`, `http-cache-semantics`, `js-yaml`, `lodash`, `file-type`) ya los
   resuelven parcheados sus padres tras Nest 12/eslint 10. Deuda viva: revisar de nuevo
   cuando `@prisma/config` empaquete `deepmerge-ts >= 8`. Hoy `npm audit` = 0.

## Cerradas en esta auditoría (2026-10-06)

- **Área `documentation/` (`R-DO`)** integrada y adaptada a este repo: sin «Core
  Engine», sin «microservicios»/«Gateway», con `.env.production.example` creado
  (hace ciertas `R-DO-3` y `R-DS-1`) y `R-DO-6` alineada con `R-C-12`/`G-8`.
- **Área `ai-contributions/` (`R-AC`)** creada: el borrador `ai/01-contribuciones.md`
  (que colisionaba con `01-dsl.md`, usaba `R-IA` y citaba un ID retirado del área
  `gateway/`) se reescribió con sufijo propio `R-AC` y sin referencias al proyecto
  origen.
- **Reglas sincronizadas con el remoto**: `git/` (58 → 68 commits, `docs/` trackeado,
  R-GE-3 ya no llama «sin gate» a `G-4`/`G-5`/`G-6`), `ci/` (2 jobs + `e2e.yml`, R-EN-2/3/4
  ya no dicen «el día que…»), `test/` (workflow/jobs, 27 ficheros, `--env-file-if-exists`,
  `R-I-12`/`R-C-12` ya no dicen «pendiente»), `_meta/CHECKLIST.md` y este snapshot.
- **Evidencia de CI**: los gates nuevos dejaron de ser «configurados» y pasaron a ✅
  con run verde real (PR #1 + `main` `37361504637`).
- **`R-DO-1` cumplido**: los 12 packages y las 2 apps tienen `README.md` (responsabilidad,
  dependencias exclusivas, superficie pública y comandos). Antes era deuda.
- **Actions actualizadas a `v7`** (`checkout`, `setup-node`, `upload-artifact`): corren
  sobre Node 24, lo que elimina el aviso de deprecación de Node 20 en los runners. La
  versión de las actions queda normada en `R-EN-1`.
- **`overrides` reducidos de 8 a 1**: revisión de mantenimiento (ADR-16) que comprobó
  que solo `deepmerge-ts` sigue siendo necesario para mantener `npm audit` en 0; los
  otros siete transitivos ya llegan parcheados por sus padres.
- **Completitud del DSL** (`R-AI-2`, `R-U-12`): `tests/dsl-completeness.test.mjs`
  comprueba que los 15 `type` del enum Zod tienen trato en el normalizador y aparecen
  en el `DSL_SPEC` que se declara al modelo. Cierra el pendiente del área `ai/`.
- **Índices de base de datos** (`R-DB-4`, `R-DB-5`): migración
  `20261006153221_add_composite_indexes` con 11 índices (FK de `jobId`/`sessionId`/
  `userId` y compuestos de consulta `Job(status, createdAt)`, `Job(userId, createdAt)`,
  `Session(domain, updatedAt)`). Antes no había ninguno salvo `User.email`.

## Historial heredado (procedencia)

- **1ª auditoría (2026-10-05)**: reescritura completa de `docs/rules/` contra la
  realidad medida (áreas nativas, `_meta` con cifras propias, ADR-16..ADR-21). Detalle
  en [`AUDIT-HISTORY.md`](./AUDIT-HISTORY.md).
- Entradas anteriores a 2026-10-05: pertenecen a **otros proyectos** («Core Engine»,
  ZKTeco) y se conservan como procedencia; no describen este repo.

## Cómo re-auditar

```bash
# Verificación de cierre: la misma que ejecuta el job build-test-lint
npm run build && npm run lint && MONGODB_MOCK=1 npm test

# Gate de seguridad y de contrato/OpenAPI
npm audit --audit-level=high && npm audit --audit-level=moderate
npm run openapi:check
npm run test:contract

# Integración con almacenes reales (G-4)
docker compose up -d postgres mongodb redis
DATABASE_URL='postgresql://scraper:scraper@localhost:5432/scraper?schema=public' \
MONGODB_URI='mongodb://localhost:27017/scraper' REDIS_URL='redis://localhost:6379' \
  npm run test:integration

# Documentación (R-DO): READMEs que faltan y plantillas de entorno
for d in apps/* packages/*; do [ -f "$d/README.md" ] || echo "falta $d/README.md"; done
ls .env.example .env.production.example
grep -c "^## ADR-" docs/decisiones.md

# Estado del repo y de los workflows
git branch -a && git rev-list --count main && git rev-list --merges --count main
ls .github/workflows/

# Evidencia de CI (R-COV-3: un gate ✅ solo con run verde)
gh run list --limit 5
gh run view <id>
```

Al terminar: **reescribir este snapshot** y **agregar una entrada** al final de
`AUDIT-HISTORY.md` (`R-COV-3`).
