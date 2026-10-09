# Migración a arquitectura hexagonal — plan y mapeo

> **Estado: migración COMPLETADA (F0–F5, 2026-10-09).** `packages/` está retirado; las 14
> libs viven en `libs/{shared,domain,application,infrastructure}`, las 2 apps son el
> composition root y el runner es **Vitest** (ADR-29). La decisión está en
> [`decisiones.md`](./decisiones.md) (ADR-27..30) y las reglas canónicas en
> [`rules/architecture/03-arquitectura-hexagonal.md`](./rules/architecture/03-arquitectura-hexagonal.md).
> Queda **F5**: adoptar **Vitest** (ADR-29) y cerrar el snapshot de auditoría.

## 1. Modelo objetivo

Arquitectura **hexagonal (puertos y adaptadores) por bounded contexts** (ADR-27):

```
apps/api  apps/worker            composition root: instancian adaptadores y los inyectan
libs/application/<contexto>      casos de uso y DTOs; coordinan puertos
libs/domain/<contexto>           entidades, value objects, servicios puros y PUERTOS
libs/infrastructure/<adaptador>  adaptadores concretos que implementan los puertos
libs/shared/<utilidad>           transversal pura (core, security, observability)
prisma/                          esquema y migraciones (los consume libs/infrastructure/storage)
```

Contextos del dominio: **`scraper`**, **`ai`**, **`execution`**. La dirección de
dependencia y las aristas prohibidas son `R-HX-2`; la verificación por lint es `R-HX-4`.

## 2. Mapeo `packages/` → `libs/` (completado)

| Origen (`packages/`, retirado) | Destino | Capa |
|---|---|---|
| `core` | `libs/domain/execution` + `libs/domain/scraper` + `libs/shared/core` | dominio + shared |
| `commands` | `libs/domain/ai` | dominio |
| `security` | `libs/shared/security` | shared (kernel) |
| `observability` | `libs/shared/observability` | shared |
| `crawler` | `libs/infrastructure/crawler` | infraestructura |
| `execution-engine` | `libs/infrastructure/execution` | infraestructura |
| `ai` | `libs/application/ai` | aplicación |
| `ai-providers` | `libs/infrastructure/ai-providers` | infraestructura |
| `queue` | `libs/infrastructure/queue` | infraestructura |
| `redis` | `libs/infrastructure/redis` | infraestructura |
| `mongodb` | `libs/infrastructure/mongodb` | infraestructura |
| `storage` | `libs/infrastructure/storage` | infraestructura |
| `prisma/` (raíz) | `prisma/` (raíz, sin mover) | — |

Nombres de paquete: `@ai-scraper/<capa>-<contexto>` (p. ej. `@ai-scraper/domain-ai`,
`@ai-scraper/infrastructure-redis`, `@ai-scraper/application-ai`). `application/ai` ya
define su puerto de caché (`AICache`) localmente, así que no depende de infraestructura.

## 3. Fases (estrangular, ADR-30)

La migración se hizo por unidades temáticas —normalmente un contexto, o una capa completa
como lote homogéneo aprobado— dejando el repo verde en cada PR (`R-HX-9`).

| Fase | Alcance | Estado |
|---|---|---|
| **F0 — Andamiaje** | Verificador de fronteras sin dependencias (`scripts/check-boundaries.mjs`, en `npm run lint`); `libs/` con README | ✅ |
| **F1 — `shared/`** | `observability` → `libs/shared/observability` | ✅ |
| **F2 — `domain/`** | `core` → `domain/{execution,scraper}` + `shared/core`; `commands` → `domain/ai` | ✅ |
| **F3 — `shared/security` + infra** | `security` → `libs/shared/security`; los 7 adaptadores → `libs/infrastructure/*` | ✅ |
| **F4 — `application/` + retirada de `packages/`** | `ai` → `libs/application/ai`; `packages/` retirado de `workspaces`/`tsconfig`/cobertura/lint | ✅ |
| **F5 — Cierre** | Adoptar **Vitest** (ADR-29): 31 ficheros a `vitest`, scripts y cobertura re-medida (65/54/56 sobre fuentes TS); cerrar el snapshot | ✅ |

## 4. Reglas de la migración (no negociables)

1. **Un tema por PR** (`R-PR-2`): un contexto, o una capa completa como lote homogéneo
   aprobado; nada de "y además" (`R-AC-6`).
2. **Verde siempre**: `npm run build && npm run lint && MONGODB_MOCK=1 npm test` antes
   del commit (`R-GC-5`); ningún PR de migración dejó el repo en rojo.
3. **Boundaries desde F0** (`R-HX-4`): el verificador sin dependencias está en
   `npm run lint`; hoy **sin excepciones legacy**.
4. **Documentación viaja**: README del módulo (`R-DO-1`, `R-DO-8`) y referencias de
   reglas se actualizan en el mismo PR.
5. **Interfaz pública estable**: los endpoints `/api/v1/**` no cambiaron durante la
   migración; `G-8` (OpenAPI) sigue verde.

## 5. Riesgos y deudas declaradas

| Riesgo / deuda | Mitigación | Registro |
|---|---|---|
| Doble mapeo `packages/` + `libs/` en `tsconfig` | ✅ Resuelto: `packages/` retirado en F4 | [`rules/_meta/AUDIT.md`](./rules/_meta/AUDIT.md) |
| Enforcement de fronteras | ✅ Verificador propio sin dependencias en `npm run lint` (se descartó `eslint-plugin-boundaries` por vulnerabilidades) | ADR-28, `R-HX-4` |
| 153 tests en `.mjs` | ✅ Resuelto: Vitest ejecuta `.mjs` sin reescritura (solo cambia el import a `vitest`) | ADR-29 |
| Sin `affected`/cache de tareas | Aceptado; re-evaluar Nx/Turbo con ADR nuevo | ADR-28 |

## 6. Cómo se cierra

La migración **está completada**: `packages/` no existe, `tsconfig.base.json` solo mapea
`libs/*/*/dist`, el lint aplica `R-HX-2` sin excepciones y el runner es **Vitest**
(ADR-29) con umbrales de cobertura re-medidos sobre fuentes TS (65 / 54 / 56). El cierre
del snapshot vive en [`_meta/AUDIT.md`](./rules/_meta/AUDIT.md).
