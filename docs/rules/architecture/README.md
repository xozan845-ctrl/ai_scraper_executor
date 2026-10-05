# Reglas de Arquitectura — AI Web Scraping Executor

Reglas doradas del estilo arquitectónico y la nomenclatura: cómo se reparte el
trabajo entre las **5 capas** (y por qué la IA no cruza de capa), cómo se comunican
`api` y `worker`, cómo se resuelve el orden de compilación del monorepo, qué se
hace cuando una dependencia no está, y cómo se nombran archivos, clases, tablas y
commits.

## Archivos

| Archivo | Contenido | Sufijo |
|---|---|---|
| `01-arquitectura.md` | Las 5 capas, separación API/worker, orden de build, `dist/` y no `src/`, fallbacks en memoria, caché con TTL, comunicacion con proveedores externos | `R-AR` (1–9) |
| `02-naming.md` | Archivos y carpetas, sufijos NestJS, clases/DTOs, variables, constantes, tablas Prisma, idioma | `R-NC` (1–9) |

> Los documentos derivados de este área (**AUDIT, CHECKLIST, historiales**) no
> viven aquí: están en [`../_meta/`](../_meta/README.md). Un área de reglas solo
> contiene `README.md` + archivos `NN-tema.md`.

## Mapa de IDs

| Prefijo | Rango | Archivo | Ámbito |
|---|---|---|---|
| `R-AR-*` | 1–9 | `01-arquitectura.md` | Capas, procesos, build y degradación |
| `R-NC-*` | 1–9 | `02-naming.md` | Nomenclatura de código, BD y commits |

## Las 5 capas

```
INTERFACE   apps/api      NestJS REST /api/v1: jobs, radiography, sessions, metrics, dashboard, health
ORCHESTRATION packages/queue + storage   BullMQ + JobStore: encolar, persistir estado
INTELLIGENCE packages/ai + ai-providers  plan y decisiones (OpenRouter | custom | Ollama)
EXECUTION   packages/commands + execution-engine + crawler   DSL Zod, HTTP/Cheerio, Playwright
DATA        packages/mongodb + redis + storage   Postgres (verdad) · MongoDB (memoria) · Redis (cola/caché)
```

El orden es intencionado: una capa solo depende de las que están **debajo**. Un
package nunca importa de `apps/*`; `apps/*` compone packages.

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

## Pendientes

- La puerta de seguridad (`npm audit`) ya es un paso de CI y reporta **0
  vulnerabilidades** (high y moderate). Detalle en
  [`../_meta/AUDIT.md`](../_meta/AUDIT.md) y
  [`../test/07-qa-gates.md`](../test/07-qa-gates.md).
- La suite corre con `--test-concurrency=1` porque Crawlee usa storage local; si
  algún día se paraleliza hay que aislar ese storage (deuda de `R-FL-*`).
