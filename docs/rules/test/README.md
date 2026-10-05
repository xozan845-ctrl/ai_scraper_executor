# Reglas de Testing — AI Web Scraping Executor

Reglas que **toda** prueba del proyecto debe cumplir. El principio rector se mantiene
heredado y sigue siendo lo más importante de esta área: los tests validaban el
comportamiento erróneo de la implementación en vez del requisito (el bug clásico: una
fecha filtrada como UTC en vez del día configurado).

> ## El runner es `node --test`, no Jest
>
> Esto cambia la forma de varias reglas y es el cambio de fondo de esta área:
>
> | | Reality |
> |---|---|
> | Runner | `node --test --test-concurrency=1` (el nativo de Node ≥20, sin dependencias) |
> | Ficheros | `tests/*.test.mjs` — **27 en disco, 26 en `npm test`** (el E2E va en otro comando, `R-FL-4`), JavaScript con import assertions, **no** `*.spec.ts` de Jest |
> | Ejecución | `npm test` (unit/integración con dobles) · `npm run test:e2e` (E2E real) · `npm run test:api` (cliente real de la API) |
> | Cobertura | **Nativa de Node** (`--experimental-test-coverage`), umbrales en el script `test`: **70 / 72 / 67** (líneas/ramas/funciones). Sin `c8`/`nyc` |
> | Concurrencia | Fija a **1**: Crawlee usa almacenamiento local y en paralelo los tests se contaminan (`R-FL-5`) |
> | Estado hoy | **143 tests / 36 suites**, todos en verde con `MONGODB_MOCK=1` |
>
> Los identificadores heredados que hablaban de Jest (`jest.coverageThreshold`,
> `*.spec.ts`, `setup de Jest`) se conservan **sin renumerar** y su texto apunta al
> runner real.

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
MONGODB_MOCK=1 npm test 2>&1 | sed -n '/start of coverage report/,/end of coverage report/p'

# Sin Docker y sin Mongo: el propio fallback en memoria cubre el arranque
npm test

# Un solo fichero (sin cobertura)
node --test tests/dsl.test.mjs

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

- **G-4/G-5/G-6 sin paso en CI**: no hay suite de integración con almacén real, ni de
  contrato, ni job E2E (el E2E real existe pero se ejecuta a mano).
- **1 moderate residual de dependencias**: `npm audit --audit-level=high` ya sale en
  0 (es paso de CI), pero `--audit-level=moderate` sigue en 1
  (`@nestjs/core <=11.1.17`), porque cerrarlo exige subir Nest de major. Ver
  `07-qa-gates.md` (`R-QA-6`) y `../_meta/AUDIT.md`.
- **`scripts/` sin lintear**: el lint cubre `apps packages`; `scripts/` (el cliente real
  de la API) queda fuera del alcance de `G-7`.

## Cerrado en la 1ª auditoría de este repo (2026-10-05)

La reescritura de esta área contra la realidad del repo dejó cerrados los snapshots
heredados que describían otro proyecto: los ficheros `*.spec.ts`, los workspaces con
`coverageThreshold`, `npm run test -w @core/<paquete>`, los fixtures de `R-E-11` en
`infra/db/init/*.sql` y la procedencia ZKTeco/Core Engine.

Además, **la puerta de seguridad quedó cerrada el mismo día**: `npm audit
--audit-level=high` pasó de exit 1 (8 high) a **exit 0**, mediante `overrides` en el
`package.json` raíz, y se añadió el paso `Security audit` al job `build-test-lint`
(`R-QA-6`/`R-SE-16`). El único residuo es 1 moderate de `@nestjs/core`. Decisión y
consecuencias en [`../../decisiones.md`](../../decisiones.md) (ADR-16). Estado y
evidencia en [`../_meta/AUDIT.md`](../_meta/AUDIT.md).

Y **`G-3` (cobertura) quedó activo** con la herramienta nativa de Node
(`--experimental-test-coverage`) y umbrales del baseline medido (70 / 72 / 67),
dentro del propio `npm test` (`R-COV-4/5`, ADR-17).
