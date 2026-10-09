# Migración a arquitectura hexagonal — plan y mapeo

> **Estado: objetivo declarado; F0 (andamiaje) completada, código sin mover (2026-10-09).**
> Este documento fija el *destino* del monorepo y el *orden* de la migración. La decisión
> está en [`decisiones.md`](./decisiones.md) (ADR-27, ADR-28, ADR-29, ADR-30); las reglas
> que rigen desde ya están en [`rules/architecture/03-arquitectura-hexagonal.md`](./rules/architecture/03-arquitectura-hexagonal.md).
> Ya existe `libs/` (vacío) y el verificador de fronteras `npm run boundaries:check`
> (integrado en `npm run lint`); **el código sigue en `packages/`**.

## 1. Modelo objetivo

Arquitectura **hexagonal (puertos y adaptadores) por bounded contexts** (ADR-27):

```
apps/api  apps/worker            composition root: instancian adaptadores y los inyectan
libs/application/<contexto>      casos de uso y DTOs; coordinan puertos
libs/domain/<contexto>           entidades, value objects, servicios puros y PUERTOS
libs/infrastructure/<adaptador>  adaptadores concretos que implementan los puertos
libs/shared/<utilidad>           transversal pura (core, observability, config, contracts)
prisma/                          esquema y migraciones (consumidos por infrastructure/persistence/prisma)
```

Contextos del dominio: **`scraper`**, **`ai`**, **`execution`**. La dirección de
dependencia y las aristas prohibidas son `R-HX-2`; la verificación por lint es `R-HX-4`.

## 2. Mapeo `packages/` → `libs/`

| Hoy (`packages/`) | Destino | Capa | Notas |
|---|---|---|---|
| `core` | `libs/domain/execution` + `libs/domain/scraper` + `libs/shared/core` | dominio + shared | ✅ **migrado**: `JobStatus`/`JobLimits`/límites → `@ai-scraper/domain-execution`; `TracedValue` → `@ai-scraper/domain-scraper`; `hashHtml` → `@ai-scraper/shared-core` |
| `commands` | `libs/domain/ai` | dominio | ✅ **migrado** (paquete `@ai-scraper/domain-ai`): DSL Zod, normalizador y `CommandValidator`; valida URLs con `@ai-scraper/shared-security` (shared kernel) |
| `security` | `libs/shared/security` | shared | ✅ **migrado** (paquete `@ai-scraper/shared-security`): shared kernel (cero dependencias, lo usan todas las capas, incluido el dominio); `safeFetchText` (I/O) y `crypto` conviven aquí |
| `observability` | `libs/shared/observability` | shared | ✅ **migrado** (paquete `@ai-scraper/shared-observability`); Logger + métricas, transversal pura |
| `crawler` | `libs/infrastructure/crawler` | infraestructura | ✅ **migrado** (`@ai-scraper/infrastructure-crawler`): Cheerio/Playwright |
| `execution-engine` | `libs/infrastructure/execution` | infraestructura | ✅ **migrado** (`@ai-scraper/infrastructure-execution`): implementa el motor HTTP/Cheerio + browser |
| `ai` | `libs/application/ai` + `libs/domain/ai` | aplicación + dominio | Casos de uso (planner, loop, recovery) en `application`; puertos (`IAIProvider`, orquestador) en `domain/ai/ports` (F4) |
| `ai-providers` | `libs/infrastructure/ai-providers` | infraestructura | ✅ **migrado** (`@ai-scraper/infrastructure-ai-providers`): adaptadores OpenRouter/Custom/Fallback |
| `queue` | `libs/infrastructure/queue` | infraestructura | ✅ **migrado** (`@ai-scraper/infrastructure-queue`): BullMQ + memoria |
| `redis` | `libs/infrastructure/redis` | infraestructura | ✅ **migrado** (`@ai-scraper/infrastructure-redis`): caché, rate limit y métricas distribuidas |
| `mongodb` | `libs/infrastructure/mongodb` | infraestructura | ✅ **migrado** (`@ai-scraper/infrastructure-mongodb`): perfiles/radiografía |
| `storage` | `libs/infrastructure/storage` | infraestructura | ✅ **migrado** (`@ai-scraper/infrastructure-storage`): `JobStore` Prisma + `InMemoryJobStore` |
| `prisma/` (raíz) | `prisma/` (raíz, sin mover) | — | El adaptador que lo consume vive en `libs/infrastructure/storage` (`R-HX-7`) |

Los splits (`core`, `ai`) se hacen **dentro del PR de ese paquete**: primero se copia
el código a su capa, se recablean imports y, si un fichero pertenece a dos capas, se
reparte en el mismo cambio con su test verde.

## 3. Fases (estrangular, ADR-30)

Cada fase son **varios PRs pequeños**: normalmente un PR = un paquete/contexto migrado
(excepción aprobada: el movimiento homogéneo de una capa completa, `R-HX-9`). El repo
permanece verde en todo momento (`R-HX-9`). Orden por dependencia (de hojas a raíz):

| Fase | Alcance | Salida |
|---|---|---|
| **F0 — Andamiaje** ✅ | Verificador de fronteras sin dependencias (`scripts/check-boundaries.mjs`, integrado en `npm run lint`); crear `libs/` con README raíz. Sin mover código | `R-HX-4` **activo**; `libs/` existe |
| **F1 — `shared/`** | `observability` → `libs/shared/observability` ✅; `core` se reparte en F2 (no se crea `shared/core` vacío) | `shared` sin dependencias de otras capas |
| **F2 — `domain/`** | `core` repartido a `domain/execution` + `domain/scraper` + `shared/core` ✅; `commands` → `domain/ai` ✅ | Dominio testeable **sin infra** |
| **F3 — infra + `shared/security`** | ✅ `security` → `libs/shared/security`; ✅ `crawler`, `execution-engine`, `ai-providers`, `queue`, `redis`, `mongodb`, `storage` → `libs/infrastructure/*` | Adaptadores en infraestructura; shared consolidado |
| **F4 — `application/`** | `ai` → `application/{ai,scraper,execution}` (casos de uso) | Lógica de orquestación fuera de infraestructura |
| **F5 — Cierre** | `apps/*` como composition root puro; retirar `packages/` de `workspaces`/`tsconfig`/lint; migrar el runner a **Vitest** (ADR-29) | `packages/` desaparece; fronteras `R-HX` cerradas |

## 4. Reglas de la migración (no negociables)

1. **Un tema por PR** (`R-PR-2`): migrar un paquete; nada de "y además" (ADR-30, `R-AC-6`).
2. **Verde siempre**: `npm run build && npm run lint && MONGODB_MOCK=1 npm test`
   antes del commit (`R-GC-5`); durante la convivencia `tsconfig.base.json` mapea
   `packages/*/dist` **y** `libs/*/dist`.
3. **Sin big-bang** (`R-HX-9`): los paquetes no migrados conservan ruta, nombre e imports.
4. **Boundaries primero** (F0 ✅): `R-HX-4` está activo desde F0 (script sin
   dependencias en `npm run lint`), para que cada movimiento nazca conforme a `R-HX-2`.
   Las excepciones legacy deben llegar a 0 en F5 (hoy queda 1: `ai→redis`).
5. **Documentación viaja**: README del módulo (`R-DO-1`, `R-DO-8`) y las referencias de
   reglas que citan `packages/<x>` se actualizan **en el PR de ese paquete**.
6. **Interfaz pública estable**: los endpoints `/api/v1/**` no cambian durante la
   migración; `G-8` (OpenAPI) sigue verde.

## 5. Riesgos y deudas declaradas

| Riesgo / deuda | Mitigación | Registro |
|---|---|---|
| Ventana con doble mapeo `packages/` + `libs/` en `tsconfig` | Deuda temporal; se cierra en F5 | [`rules/_meta/AUDIT.md`](./rules/_meta/AUDIT.md) |
| Fronteras sin enforcement hasta F0 | ✅ Resuelto: verificador propio sin dependencias en `npm run lint` (se descartó `eslint-plugin-boundaries` por vulnerabilidades) | ADR-28, `R-HX-4` |
| 153 tests en `.mjs` sobre `dist` | Vitest ejecuta `.mjs` sin reescritura; migrar por capas | ADR-29 |
| Sin `affected`/cache de tareas | Aceptado; re-evaluar Nx/Turbo con ADR nuevo | ADR-28 |
| Reglas de otras áreas citan `packages/*` | Se actualizan por paquete, no en bloque | `R-DO-8` |

## 6. Cómo se cierra

La migración termina cuando: `packages/` está vacío y retirado de `workspaces`,
`tsconfig.base.json` solo mapea `libs/*/dist`, el lint aplica `R-HX-2`, el runner es
Vitest (ADR-29) con umbral de cobertura re-medido y sin bajar, y todo README/regla cita
las rutas `libs/*`. En ese momento se actualiza [`_meta/AUDIT.md`](./rules/_meta/AUDIT.md)
y se marca `R-HX-9` como cumplida.
