# 02 — Reglas Doradas de Nomenclatura

Aplica a: nombres de archivos, clases, variables, tablas y mensajes de commit en todo
el monorepo (`apps/*` + `libs/*`).

> **Idioma.** El código de este repo es **inglés** (`jobId`, `results`, `selector`).
> Esa es la convención real y la que se aplica: los ficheros heredados que mezclaban
> español en identificadores están fuera de norma (`R-NC-6`).

## Reglas

| ID | Regla |
|---|---|
| R-NC-1 | **Archivos y carpetas (`kebab-case` + notación de punto)**: los archivos de NestJS usan `[nombre].[tipo].ts`, con el nombre en `kebab-case` y el sufijo en inglés y **singular**, separado por un punto. Ejemplos correctos: `jobs.controller.ts`, `api-key.guard.ts`, `create-job.dto.ts`. Los folders van en `kebab-case` o en minúsculas si son una palabra: `dto/`, `ai-providers/`. En `libs/*/*/src` se sigue el mismo criterio: `openrouter.provider.ts`, `fallback.provider.ts`, `session-store.ts`. |
| R-NC-2 | **Sufijos por tipo de archivo**: NestJS: `*.controller.ts`, `*.service.ts`, `*.module.ts`, `*.guard.ts`, `*.pipe.ts`, `*.interceptor.ts`, `*.filter.ts`, `*.dto.ts`, `*.entity.ts`. Adaptadores e integraciones: `*.provider.ts` (proveedor de IA). Otros: `*.engine.ts` (`ExecutionEngine`, `BrowserEngine`), `*.runner.ts`, `*.store.ts`, `*.queue.ts`, `*.cache.ts`. Tests: **`*.test.mjs`** en `tests/` (el runner es `node --test`, no Jest: ver `R-U-1` en [`../test/01-reglas-unit.md`](../test/01-reglas-unit.md)). El sufijo `test` es siempre terminal. |
| R-NC-3 | **Clases y tipos (PascalCase)**: toda clase, interfaz o tipo de TypeScript en `PascalCase`. Ejemplos: `ExecutionEngine`, `AIOrchestrator`, `JobStatus`, `TracedValue`. Los **DTOs** declaran su dirección y propósito: `CreateJobDto`, `RegisterFirstDto`, `SessionDto`, y los de salida llevan sufijo explícito si conviven con uno de entrada del mismo nombre (`CreateJobResponseDto`). No se crea un `[Nombre]Dto` genérico cuya dirección sea ambigua. |
| R-NC-4 | **Variables, funciones y métodos (`camelCase`)**: variables, parámetros, funciones de bloque y métodos en `camelCase`. Ejemplos: `const jobLimits`, `function normalizeCommand(raw)`, `async createJob()`. |
| R-NC-5 | **Constantes y enums (`UPPER_SNAKE_CASE`)**: constantes de módulo y miembros de enums en `UPPER_SNAKE_CASE`. Ejemplos: `const DEFAULT_LIMITS`, `const HARD_LIMITS`, `const SCRAPING_DEAD_QUEUE`, `enum JobStatus { CREATED, QUEUED, COMPLETED }`. Las claves de un objeto de configuración literales también van en `UPPER_SNAKE_CASE` cuando son constantes de módulo. |
| R-NC-6 | **Un solo idioma, sin Spanglish**: los identificadores del código van en **inglés** (`jobId`, `sessionStatus`, `extractList`). La documentación, los comentarios de regla y este árbol de reglas van en **español**. Prohibido mezclar ambos en el mismo identificador (`getTrabajos`, `sessionDetalle`, `extraccionLista`). Los **nombres de dominio del scraping que el producto muestra al usuario final** (etiquetas de un dashboard, mensajes de error visibles) sí van en español, pero viven en el dato, no en el identificador. |
| R-NC-7 | **Base de datos (Prisma: `camelCase` en el modelo, `snake_case` en el SQL)**: los campos del `schema.prisma` y los tipos devueltos por el cliente Prisma usan `camelCase` (`createdAt`, `jobId`, `sourceUrl`, `sessionId`). El mapeo a columnas físicas se hace con `@map` cuando el nombre difiere. El nombre de tabla/columna en SQL crudo (migraciones escritas a mano, `scripts/`) va en `snake_case`. La API expone **camelCase**, no `snake_case`. |
| R-NC-8 | **Valores de enum y estados como cadenas literales**: cuando un estado se persiste como `String` (columna `status` de `Job`, `Session`, `Command`), el valor es el miembro del enum de [`../../../libs/domain/execution/src/index.ts`](../../../libs/domain/execution/src/index.ts) (`'CREATED'`, `'READY'`, `'COMPLETED'`, `'PENDING'`). Se escribe el literal en mayúsculas en todas partes; nunca se inventa una variante en minúsculas ni un string que no exista en el enum. |
| R-NC-9 | **Commits (Conventional Commits)**: todo mensaje de commit sigue el estándar Conventional Commits, en español imperativo y con el ámbito real del cambio (`libs/domain/ai`, `api`, `worker`, `rules`, `ci`): `fix(domain-ai): validar tipo antes de normalizar (R-AI-4)`. El detalle del formato vive en `R-GC-1..7` ([`../git/02-commits.md`](../git/02-commits.md)). |
| R-NC-10 | **Estructura interna y nombre de una lib hexagonal**: dentro de `libs/<capa>/<contexto>/src`, las carpetas se nombran por rol y en `kebab-case`: `entities/`, `value-objects/`, `services/` y `ports/` (dominio), `use-cases/` y `dtos/` (aplicación), `adapters/` (infraestructura); `src/index.ts` expone solo la superficie pública (`R-HX-8`). El paquete se llama `@ai-scraper/<capa>-<contexto>` (`R-HX-6`). `packages/` está retirado (`R-HX-9`). |

## Verificación

```bash
# Ningún artefacto compilado dentro de src/ (R-AR-5, R-NC-2): debe imprimir vacío
find apps packages libs -path '*/src/*' \( -name '*.js' -o -name '*.d.ts' -o -name '*.map' \) -not -path '*/node_modules/*'

# Los tests viven en tests/ y terminan en .test.mjs (R-NC-2)
ls tests/*.test.mjs | wc -l
```
