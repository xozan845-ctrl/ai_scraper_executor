# Reglas de Testing — AI Web Scraping Executor

Reglas que **toda** prueba del proyecto debe cumplir. El principio rector se mantiene
heredado y sigue siendo lo más importante de esta área: los tests validaban el
comportamiento erróneo de la implementación en vez del requisito (el bug clásico: una
fecha filtrada como UTC en vez del día configurado).

> ## El runner es `Vitest` (ADR-29), no Jest
>
> | | Reality |
> |---|---|
> | Runner | **`vitest`** (`npm test`); config en `vitest.config.mjs`. Ejecuta en serie |
> | Ficheros | `tests/*.test.mjs` — **31 en disco, 28 en `npm test`** (contrato, integración y E2E van en otros comandos, `R-FL-4`), JavaScript, **no** `*.spec.ts` de Jest |
> | Ejecución | `npm test` (unit + propiedades, con dobles) · `npm run test:contract` · `npm run test:integration` (Docker) · `npm run test:e2e` (release) · `npm run test:api` (cliente real) |
> | Cobertura | **v8 de Vitest**, umbrales en `vitest.config.mjs`: **65 / 54 / 56** (líneas/ramas/funciones), medidos sobre fuentes TS (ADR-29) |
> | Concurrencia | Fija a **1** (`fileParallelism: false`): Crawlee usa almacenamiento local y en paralelo los tests se contaminan (`R-FL-5`) |
> | Estado hoy | **167 tests / 28 suites** en `npm test` + **9 de contrato** + **7 de integración**, todos en verde |
>
> Los identificadores heredados que hablaban de Jest (`jest.coverageThreshold`,
> `*.spec.ts`, `setup de Jest`) se conservan **sin renumerar** y su texto apunta al
> runner real.

> ## ✅ Vitest implementado (ADR-29, 2026-10-09)
>
> `vitest@5` + `@vitest/coverage-v8` sustituyen a `vitest` (ADR-03) y a la cobertura
> nativa (ADR-17). Los 31 ficheros usan `vitest` en lugar de `vitest`; `before`/`after`
> pasan a `beforeAll`/`afterAll`. **La cobertura ahora se mide sobre los fuentes TS** (el
> provider mapea por los sourcemaps), así que los umbrales se re-basaron a **65 / 54 / 56**
> (base nueva, no bajada sobre `dist`). Vitest desbloquea el mutation testing (`R-MT-1`).

## Archivos

| Archivo | Contenido |
|---|---|
| `01-reglas-unit.md` | Reglas para unit tests (DSL, normalizador, motor, crawler, proveedores, stores) |
| `02-reglas-integracion.md` | Reglas para pruebas con HTTP real y almacén real |
| `03-reglas-e2e.md` | Reglas para E2E contra un sitio real con LLM real |
| `04-reglas-contrato.md` | Reglas de contrato de la API (`/api/v1/**`) y su Swagger |
| `05-reglas-robustez.md` | Calidad: inputs hostile, property-based, mutation, anti-flakiness |
| `06-estandares-cobertura.md` | Matriz de capas por tipo de cambio, gates de CI (`G-*`), estado real |
| `07-qa-gates.md` | Política global de QA y puerta de seguridad (`R-QA`) |

> Los documentos derivados de este área (**AUDIT, CHECKLIST, AUDIT-HISTORY**) no viven
> aquí: están en [`../_meta/`](../_meta/README.md). Un área de reglas solo contiene
> `README.md` + archivos `NN-tema.md`.

## Mapa de IDs

| Prefijo | Rango | Archivo | Ámbito |
|---|---|---|---|
| `R0` | — | `README.md` | Principio rector |
| `R-U-*` | 1–18 | `01-reglas-unit.md` | Unit tests |
| `R-I-*` | 1–13 | `02-reglas-integracion.md` | Integración con almacén real |
| `R-E-*` | 1–13 | `03-reglas-e2e.md` | E2E real (sitio + LLM reales) |
| `R-C-*` | 1–12 | `04-reglas-contrato.md` | Contrato de la API |
| `R-REG-*` | 1–3 | `05-reglas-robustez.md` | Regression-first |
| `R-PB-*` | 1–3 | `05-reglas-robustez.md` | Property-based |
| `R-MT-*` | 1–3 | `05-reglas-robustez.md` | Mutation testing |
| `R-RB-*` | 1–4 | `05-reglas-robustez.md` | Robustez de entradas |
| `R-FL-*` | 1–5 | `05-reglas-robustez.md` | Anti-flakiness |
| `G-*` | 1–9 | `06-estandares-cobertura.md` | Gates de CI |
| `R-COV-*` | 1–6 | `06-estandares-cobertura.md` | Anti-regresión, alcance y estado de la cobertura |
| `R-QA-*` | 1–6 | `07-qa-gates.md` | Política global de QA y security gate |

> La mecánica de CI (gatillos, runner, evidencia) vive en [`../ci/`](../ci/README.md);
> aquí solo los gates `G-*`. Las reglas doradas que los tests protegen (SSRF,
> trazabilidad, presupuestos, idempotencia) viven en [`../security/`](../security/README.md),
> [`../scraping/`](../scraping/README.md) y [`../data/`](../data/README.md).

## Principio rector

> **R0 — El test valida el REQUISITO, no la implementación.**
> Si el requisito es "un item extraído trae `_source` con la URL de origen", el test
> debe asertar contra esa semántica, nunca contra lo que el código produce hoy. Un test
> que pasa con la implementación bugueada es un test inválido.

## Convenciones (mantener el "punto fijo")

1. **Formato de ID:** `R-<SUFIXO>-<n>` con `n` secuencial e incremental dentro del
   archivo. Un sufijo pertenece a **un solo archivo**. Los gates de CI usan `G-<n>`.
   Nunca reutilizar ni renumerar IDs existentes.
2. **Formato de regla:** tabla `| ID | Regla |`; redacción en imperativo, concreta y
   verificable (si no se puede comprobar en un PR, no es una regla).
3. **Archivos:** numeración `NN-tema.md` con título `# NN — Tema`. Un archivo nuevo = un
   sufijo nuevo.
4. **Referencias cruzadas:** siempre con el ID completo (`R-AI-4`), jamás "la regla 4".
   Antes de renombrar/eliminar una regla, `grep -rn "R-XX-n" docs/rules/` para actualizar
   todas las referencias (incluye `../_meta/`).
5. **Agregar una regla nueva:** añadir en su archivo → actualizar el **Mapa de IDs** de
   este README → reflejarla en [`../_meta/CHECKLIST.md`](../_meta/CHECKLIST.md) si afecta
   a revisión de PR → re-auditar (`R-COV-3`).
6. **Estado ≠ regla:** las reglas son permanentes; el cumplimiento vive en
   [`../_meta/AUDIT.md`](../_meta/AUDIT.md) (snapshot) y
   [`../_meta/AUDIT-HISTORY.md`](../_meta/AUDIT-HISTORY.md) (log).

## Ciclo de vida

1. Toda función o bug debe incluir sus pruebas en la capa correspondiente (§ matriz de
   capas en `06-estandares-cobertura.md`).
2. Todo bug nuevo: **primero** se escribe el test que falla con el bug, luego la fix
   (`05-reglas-robustez.md`, `R-REG-1`).
3. La auditoría se re-ejecuta antes de cada release: se reescribe
   [`../_meta/AUDIT.md`](../_meta/AUDIT.md) y se agrega una entrada al final de
   [`../_meta/AUDIT-HISTORY.md`](../_meta/AUDIT-HISTORY.md).

## Cómo auditar (este repo)

```bash
# La suite completa, con MongoDB simulado (lo que corre CI): incluye cobertura (G-1+G-3)
MONGODB_MOCK=1 npm test

# Cobertura sola, con el reporte por fichero
MONGODB_MOCK=1 npm test 2>&1 | sed -n '/Coverage summary/,/====/p'

# Sin Docker y sin Mongo: el propio fallback en memoria cubre el arranque
npm test

# Un solo fichero (sin cobertura)
npx vitest run tests/dsl.test.mjs

# Contrato de la API (G-5): arranca la API y valida formas
npm run test:contract

# Integración con almacenes reales (G-4): requiere Docker
npm run test:integration

# Detección de tests intermitentes (R-FL-1): repite la suite n veces
npm run test:repeat -- 20

# Lint y build (job `build-test-lint`, gate G-7)
npm run lint
npm run build

# Puerta de seguridad (R-QA-6 / R-SE-16) — hoy en verde (high = 0)
npm audit --audit-level=high

# E2E real: necesita Docker, OPENROUTER_API_KEY y Playwright Chromium en el host
npm run dev:e2e

# Cliente real de la API (flujos completos de /sessions, /jobs, /radiography)
npm run test:api:fast
```

## Pendientes (deuda abierta)

- **Mutation testing** (`R-MT-1`, ADR-31): **adoptado con el command runner** de Stryker
  (`npm run test:mutation`; muta el `dist` crítico y lanza los tests de lógica pura en un
  proceso nuevo por mutante; no es gate de PR). El *runner* de Vitest se descartó por
  **falsos supervivientes** (stryker-js #6073/#4306). Con el command runner,
  `libs/domain/execution` mide **92.73 %** (51/55; el resto es boilerplate de TS).
- **Cobertura sobre fuentes TS** (`R-COV-4`, ADR-29): Vitest mide el TS (por sourcemaps),
  no el `dist`; umbral vigente **65 / 54 / 56**.
- **Cliente real de la API (`npm run test:api`) no es un gate**: es un smoke de flujos
  completos que se ejecuta a mano contra una API levantada.

## Cerrado en la 1ª auditoría de este repo (2026-10-05)

La reescritura de esta área contra la realidad del repo dejó cerrados los snapshots
heredados que describían otro proyecto: los ficheros `*.spec.ts`, los workspaces con
`coverageThreshold`, `npm run test -w @core/<paquete>`, los fixtures de `R-E-11` en
`infra/db/init/*.sql` y la procedencia ZKTeco/Core Engine.

Además, **la puerta de seguridad quedó cerrada el mismo día**: `npm audit
--audit-level=high` pasó de exit 1 (8 high) a **exit 0**, mediante `overrides` en el
`package.json` raíz, y se añadió el paso `Security audit` al job `build-test-lint`
(`R-QA-6`/`R-SE-16`). Con Nest 12 el árbol queda en **0 vulnerabilidades** (también
moderate) y se retiró `--legacy-peer-deps`. Decisiones y consecuencias en
[`../../decisiones.md`](../../decisiones.md) (ADR-16 y ADR-18). Estado y evidencia en
[`../_meta/AUDIT.md`](../_meta/AUDIT.md).

Y **`G-3` (cobertura)**: tras adoptar Vitest (ADR-29) se mide sobre fuentes TS con v8 y
umbrales **65 / 54 / 56**, dentro de `npm test` (`R-COV-4/5`).

Y el **property-based testing (`R-PB`) es real**: `tests/property.test.mjs` con
`fast-check` dentro de `npm test`, que ya encontró y dejó corregidos tres defectos
(`normalizeJobLimits(5e-324) → 0`, la resolución de alias contra el prototipo y
`normalizeDomain` no idempotente). La mutación (`R-MT`) queda diferida a propósito
con su disparador (ADR-20).

Y las **capas de test que faltaban ya existen**: `G-5` (contrato) es el paso
`Contract` de CI; `G-4` (integración con Postgres/Mongo/Redis reales) es el job
`integration`; `G-6` (E2E) es el workflow [`e2e.yml`](../../../.github/workflows/e2e.yml)
de release. ADR-21.
