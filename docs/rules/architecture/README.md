# Reglas de Arquitectura — AI Web Scraping Executor

Reglas doradas del estilo arquitectónico y la nomenclatura: cómo se reparten las
**capas hexagonales** (`domain`, `application`, `infrastructure`, `shared` y `apps/*`
como composition root, ADR-27) y por qué la IA no cruza de capa, cómo se comunican
`api` y `worker`, cómo se resuelve el orden de compilación del monorepo, qué se
hace cuando una dependencia no está, y cómo se nombran archivos, clases, tablas y
commits.

## Archivos

| Archivo | Contenido | Sufijo |
|---|---|---|
| `01-arquitectura.md` | Las 5 capas históricas (mapeo de runtime), separación API/worker, orden de build, `dist/` y no `src/`, fallbacks en memoria, caché con TTL, comunicacion con proveedores externos | `R-AR` (1–9) |
| `02-naming.md` | Archivos y carpetas, sufijos NestJS, clases/DTOs, variables, constantes, tablas Prisma, idioma, estructura interna de una lib | `R-NC` (1–10) |
| `03-arquitectura-hexagonal.md` | Modelo canónico: 4 capas + composition root, dirección de dependencia, apps delgadas, propiedad de puertos, adaptadores independientes, enforcement y migración strangler | `R-HX` (1–14) |

> Los documentos derivados de este área (**AUDIT, CHECKLIST, historiales**) no
> viven aquí: están en [`../_meta/`](../_meta/README.md). Un área de reglas solo
> contiene `README.md` + archivos `NN-tema.md`.

## Mapa de IDs

| Prefijo | Rango | Archivo | Ámbito |
|---|---|---|---|
| `R-AR-*` | 1–9 | `01-arquitectura.md` | Capas históricas, procesos, build y degradación |
| `R-NC-*` | 1–10 | `02-naming.md` | Nomenclatura de código, BD, libs y commits |
| `R-HX-*` | 1–14 | `03-arquitectura-hexagonal.md` | Modelo canónico, fronteras, responsabilidades y migración |

## Modelo canónico (hexagonal, ADR-27)

```
apps/*            entry points delgados + composition root — instancia adaptadores y los inyecta
libs/domain/*     entidades, value objects, servicios puros y PUERTOS (sin frameworks)
libs/application/* casos de uso y DTOs (coordinan puertos)
libs/infrastructure/* adaptadores concretos e independientes (Prisma, Mongo, Redis, BullMQ, Crawlee, OpenRouter)
libs/shared/*     transversal sin lógica de bounded context (core, security, observability, config, contracts)
```

La dirección de dependencia y las aristas prohibidas están normadas en `R-HX-2`; el
enforcement por lint en `R-HX-4`; apps delgadas, puertos y adaptadores en
`R-HX-10..13`; y la definición de cierre en `R-HX-14`. El mapeo de los paquetes
actuales a `libs/` y el orden de migración strangler viven en
[`../../migracion-arquitectura.md`](../../migracion-arquitectura.md).

## Vista histórica de las 5 capas (runtime, `R-AR-2`)

Se conserva para leer los flujos de un job; **ya no es el modelo canónico**. Su
correspondencia con las capas hexagonales:

```
INTERFACE   apps/api      NestJS REST /api/v1            → composition root (apps/)
ORCHESTRATION libs/infrastructure/queue + storage   BullMQ + JobStore → infrastructure/
INTELLIGENCE libs/application/ai + ai-providers  plan y decisiones → application/ + infrastructure/
EXECUTION   libs/domain/ai + execution-engine + crawler → domain/ (DSL) + infrastructure/
DATA        libs/infrastructure/mongodb + redis + storage   Postgres · MongoDB · Redis → infrastructure/
```

Una capa solo depende de las que están **debajo**; un lib nunca importa de `apps/*`.

## Reglas de otras áreas que exige esta (cross-refs)

| ID | Exigencia |
|---|---|
| `R-AR-1` | La IA no ejecuta código: todo lo que emite pasa por el DSL → ver `R-AI-1` (`../ai/01-dsl.md`) |
| `R-AR-3` | `apps/worker` no se despliega sin Chromium: la imagen es `bookworm-slim` → `R-CD-3` (`../cd/01-despliegue.md`) |
| `R-AR-6` | Caché con TTL ≠ fuente de verdad → `R-DI-5` (`../data/01-integridad.md`) y `R-RD-3` (`../db/03-redis.md`) |
| `R-AR-7` | Todo borde con proveedor externo va por adaptador → `R-AI-8` (`../ai/02-modelos.md`) |
| `R-AR-8` | Reintentos y cola de muertos → `R-SC-9` (`../scraping/01-motor.md`) |
| `R-AR-9` | Migrar un schema es cambio normativo → `R-DB-6` (`../db/01-database.md`) |
| `R-NC-9` | Commits → `R-GC-1..7` (`../git/02-commits.md`) |
| `R-HX-4` | Fronteras de capa verificadas por lint → gate `G-7` (`../test/07-qa-gates.md`) |
| `R-HX-9` | Migración strangler sin romper build → `R-AR-4` y `R-PR-2` (`../git/04-pr.md`) |
| `R-HX-10..14` | Conformidad completa: apps delgadas, puertos del consumidor, adaptadores independientes y evidencia de cierre → ADR-33 |

## Pendientes

- **Fronteras (`R-HX-4`)**: el verificador actual está activo vía
  [`scripts/check-boundaries.mjs`](../../../scripts/check-boundaries.mjs) dentro de
  `npm run lint`, pero aún cubre solo imports de fuente entre capas. F10 debe añadir
  manifiestos, puertos, apps delgadas y adaptadores independientes (ADR-33).
- **Traslado a `libs/` (`R-HX-9`)**: **completado** — `packages/` retirado; shared,
  domain, application e infrastructure viven en `libs/`.
- **Conformidad hexagonal (`R-HX-10..14`)**: **pendiente** — F7–F10 extraen puertos y
  casos de uso, desacoplan adaptadores, adelgazan apps y activan la verificación completa.
  Mapeo, evidencia y fases en
  [`../../migracion-arquitectura.md`](../../migracion-arquitectura.md) (ADR-27/30/33).
- **Runner Vitest (ADR-29)**: **implementado** (F5); el área
  [`../test/`](../test/README.md) describe Vitest y `vitest.config.mjs`.
- La puerta de seguridad (`npm audit`) ya es un paso de CI y reporta **0
  vulnerabilidades** (high y moderate). Detalle en
  [`../_meta/AUDIT.md`](../_meta/AUDIT.md) y
  [`../test/07-qa-gates.md`](../test/07-qa-gates.md).
- La suite corre en serie (`fileParallelism: false`) porque Crawlee usa storage local; si
  algún día se paraleliza hay que aislar ese storage (deuda de `R-FL-*`).
