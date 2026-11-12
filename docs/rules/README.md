# rules/ — Reglas del proyecto (punto fijo)

Este directorio define las reglas **permanentes** de **ai-scraping-executor**: el punto
fijo al que no se desvía ninguna decisión técnica. Las reglas no cambian por
conveniencia de un PR; cambian por decisión explícita y quedan registradas aquí y en
[`../decisiones.md`](../decisiones.md) como ADR.

> **La IA ES EL CEREBRO. CRAWLEE ES EL MOTOR.** La IA decide **QUÉ** (un DSL cerrado
> de 19 comandos, [`ai/`](./ai/README.md)); el motor decide **CÓMO**
> ([`scraping/`](./scraping/README.md)). Esa frase es el criterio con el que se lee
> cualquier regla ambigua: si la decisión la puede tomar un modelo, necesita estar
> dentro del DSL y pasar por validación.

## Estructura

```
rules/
├── README.md           ← este índice: áreas, estado, convenciones globales
│
├── architecture/       capas hexagonales, monorepo, orden de build, naming (R-HX/R-AR/R-NC)
├── ai/                 DSL cerrado, Zod, anti-alucinación, modelos y prompts (R-AI)
├── ai-contributions/   cómo colabora un agente de IA al tocar el repo (R-AC)
├── security/           SSRF, allowlist, autenticación y credenciales (R-SE)
├── scraping/           motor de extracción, presupuestos, trazabilidad (R-SC)
├── data/               integridad de los datos y seguridad de los datos (R-DI/R-DS)
├── db/                 Postgres/Prisma, MongoDB y Redis (R-DB/R-MO/R-RD)
├── observability/      logs JSON + correlación y métricas + dashboard (R-OB/R-TM)
├── documentation/      READMEs, ADRs, plantillas de entorno y OpenAPI (R-DO)
│
├── test/               Vitest: unit, integración, E2E, contrato, gates (R-U/R-I/…)
├── git/                stage, commits, push, PR y ramas (R-GA/R-GC/R-GP/R-PR/R-GE)
├── ci/                 los workflows reales: gatillos, runner, evidencia (R-CI/R-EN)
├── cd/                 entrega: compose, imágenes, entornos, rollback (R-CD)
│
└── _meta/              ⚠️ documentos DERIVADOS — nunca normativos
    ├── CHECKLIST.md        herramienta de revisión de PR
    ├── AUDIT.md            snapshot del estado (se reescribe por auditoría)
    └── AUDIT-HISTORY.md    log append-only de auditorías
```

**Regla de estructura (la más importante de esta carpeta):**

> Un **área** (`architecture/`, `ai/`, `ai-contributions/`, `security/`, `scraping/`,
> `data/`, `db/`, `observability/`, `documentation/`, `test/`, `git/`, `ci/`, `cd/`)
> solo contiene `README.md` + archivos de reglas `NN-tema.md`. Todo documento derivado
> (audit, checklist, log, estado) vive en `_meta/` y jamás dentro de un área.

## Áreas

| Área | Estado | Índice | Contenido |
|---|---|---|---|
| `architecture/` | ✅ activa | [`README.md`](./architecture/README.md) | Modelo canónico hexagonal (`domain`/`application`/`infrastructure`/`shared` + `apps/*` como composition root), dirección de dependencia y aristas prohibidas, puertos/adaptadores, enforcement por lint y migración strangler (`R-HX`); vista histórica de las 5 capas, separación API/worker, orden de build del monorepo, `dist/` y no `src/`, fallbacks en memoria (`R-AR`); naming de archivos/clases/tablas/commits (`R-NC`) |
| `ai/` | ✅ activa | [`README.md`](./ai/README.md) | El DSL de 19 comandos: Zod estricto, normalizador anti-alucinación, límites anti-escalada, presupuesto de tokens, allowlist no escalable, prompts, fallback de modelos OpenRouter, caché LLM, circuit breaker (`R-AI`) |
| `ai-contributions/` | ✅ activa | [`README.md`](./ai-contributions/README.md) | Cómo colabora un agente de IA en el repo: lectura de contexto, tooling, commits atómicos, gates sin pases libres, PR como entregable, no refactors oportunistas (`R-AC`) |
| `security/` | ✅ activa | [`README.md`](./security/README.md) | SSRF centralizado (`assertPublicUrl`/`assertSafeUrl`/`safeFetchText`), allowlist de dominios, `x-api-key` fail-closed, credenciales de sesión cifradas AES-256-GCM, CORS y cabeceras, rate limiting, `npm audit` (`R-SE`) |
| `scraping/` | ✅ activa | [`README.md`](./scraping/README.md) | El motor: HTTP/Cheerio antes que browser, presupuestos por job, deduplicación de URLs, `PageCache` con TTL, browser pool, cancelación, recovery, trazabilidad `_source` (`R-SC`) |
| `data/` | ✅ activa | [`README.md`](./data/README.md) | Integridad (máquina de estados de `JobStatus`, idempotencia de jobs y LLM, trazabilidad, caché ≠ verdad, límites) y seguridad (secretos, credenciales cifradas, PII, `npm audit`) (`R-DI`/`R-DS`) |
| `db/` | ✅ activa | [`README.md`](./db/README.md) | Postgres con Prisma (migraciones, índices, transacciones), MongoDB (radiografía y perfiles aprendidos), Redis (cola, caché, rate limit, métricas) y el fallback en memoria (`R-DB`/`R-MO`/`R-RD`) |
| `observability/` | ✅ activa | [`README.md`](./observability/README.md) | Logs JSON con `correlationId` por `AsyncLocalStorage`, niveles, sanitización; métricas Prometheus `scraper_*` con label `instance`, RED, métricas distribuidas por Redis, `/api/v1/health` y `/api/v1/dashboard` (`R-OB`/`R-TM`) |
| `documentation/` | ✅ activa | [`README.md`](./documentation/README.md) | READMEs por paquete/app, sincronización del root, plantillas de entorno sin secretos, comentarios/JSDoc, ADRs, spec OpenAPI versionada y `_meta` (`R-DO`) |
| `test/` | ✅ activa | [`README.md`](./test/README.md) | El runner es **Vitest** sobre `tests/*.test.mjs` (no Jest): unit, integración, E2E, contrato, robustez, cobertura y QA gates (`R-U`/`R-I`/`R-E`/`R-C`/`G-*`) |
| `git/` | ✅ activa | [`README.md`](./git/README.md) | Flujo git: `git add` explícito, Conventional Commits, `git push` sin fuerza, `gh pr` con evidencia, y el modelo de ramas real (hoy una sola rama `main`) (`R-GA`/`R-GC`/`R-GP`/`R-PR`/`R-GE`) |
| `ci/` | ✅ activa | [`README.md`](./ci/README.md) | Los workflows reales: [`ci.yml`](../../.github/workflows/ci.yml) (jobs `build-test-lint` + `integration`) y [`e2e.yml`](../../.github/workflows/e2e.yml) (release); gatillos, Node 22, `npm ci`, evidencia (`R-CI`/`R-EN`) |
| `cd/` | ✅ activa | [`README.md`](./cd/README.md) | Entrega: `docker-compose.yml` (postgres+mongodb+redis+migrate+api+worker), Dockerfiles, migraciones solo hacia adelante, entornos, smoke y rollback (`R-CD`) |
| `_meta/` | ⚠️ **no normativo** | [`README.md`](./_meta/README.md) | Derivados: checklist, snapshot de auditoría, histórico |

## Convenciones globales (aplican a todas las áreas)

1. **Archivos:** `README.md` (índice del área + mapa de IDs + pendientes) y reglas en
   archivos `NN-tema.md` con título `# NN — Tema`. Nunca más de un tema por archivo.
2. **IDs de regla:** `R-<SUFIXO>-<n>` secuencial e incremental, un sufijo por archivo,
   un archivo por área temática. Gates de CI: `G-<n>`. Un ID = una regla, para siempre
   (nunca renumerar ni reutilizar).
3. **Formato de regla:** tabla `| ID | Regla |`, redacción en imperativo y verificable
   en un PR. Si no se puede comprobar, no es una regla.
4. **Referencias:** siempre por ID completo (`R-AI-3`), nunca por número suelto. Las
   referencias entre áreas incluyen la ruta (`R-AR-2` en `../architecture/01-arquitectura.md`).
5. **Regla ≠ estado:** la regla dice *qué*; [`_meta/AUDIT.md`](./_meta/AUDIT.md) dice
   *qué tan cumplida está*. En cada auditoría se reescribe el snapshot y se agrega una
   entrada al histórico.
6. **Referencias cruzadas:** `grep -rn "R-XX-n" docs/rules/` antes de renombrar/eliminar.

## Comprobación de realidad: las tres reglas que mandan sobre todas las demás

Estas son las que más veces se incumplen. Si una regla nueva las contradice, es que
la regla nueva está mal:

1. **`npm run build && npm run lint && MONGODB_MOCK=1 npm test` en verde** antes de
   dar cualquier tarea por terminada (`R-GC-5`, gate `G-7`).
2. **Toda URL que entre al sistema pasa por `@ai-scraper/shared-security`** (`R-SE-1`). La IA
   nunca ejecuta código ni decide a qué host se conecta.
3. **Ninguna regla se da por cumplida sin evidencia ejecutable**: un gate solo se marca
   ✅ con un run verde de CI, no con "está configurado" (`R-COV-3`).

## Procedencia de esta carpeta

Estas reglas nacieron de un proyecto ajeno (un e-commerce de microservicios con
RabbitMQ, Postgres/Supabase y Angular) y de otro anterior (ZKTeco Attendance). **La
metodología se conserva intacta** — IDs inmutables, tablas `| ID | Regla |`, separación
`_meta/`, gates `G-n`, ratchet, cross-refs por ID completo — porque es lo único que
sobrevive al cambio de dominio. **El contenido se reescribió** contra la realidad de
este repo.

| Antes (proyecto origen) | Ahora (este repo) | Motivo |
|---|---|---|
| `gateway/` (`R-GW`) | [`security/`](./security/README.md) (`R-SE`) | El perímetro aquí no es un JWT gateway: es SSRF + `x-api-key` + credenciales cifradas + rate limit. |
| `microservice/` (`R-MS`/`R-MI`) | [`ai/`](./ai/README.md) (`R-AI`) | No hay microservicios; el dominio propio es el "cerebro" (DSL, prompts, modelos). |
| `db/02-supabase.md` (`R-SB`) | [`db/02-mongodb.md`](./db/02-mongodb.md) + [`db/03-redis.md`](./db/03-redis.md) (`R-MO`/`R-RD`) | No hay Supabase, RLS ni `auth.uid()`. Hay MongoDB (memoria) y Redis (cola/caché/métricas). |
| CQRS, outbox, coreografía, Event Sourcing | — | Este repo no usa CQRS ni outbox: el IPC es BullMQ y el estado de un job es una fila. |
| `Money`/centavos, stock, partida doble, liquidaciones | [`data/01-integridad.md`](./data/01-integridad.md) (`R-DI`) reescrita | El activo de datos es el **resultado de scraping con trazabilidad**, no el dinero. |
| `@nestjs/swagger` + Jest + `coverageThreshold` por workspace | [`test/`](./test/README.md) con **Vitest** | El runner es Vitest sobre `.test.mjs`; no hay Jest. La cobertura es v8 de Vitest con umbrales medidos (`G-3`, `R-COV-4/5`). |
| 4 jobs de CI (`security-gate`/`lint`/`test`/`build`) | [`ci/01-flujos.md`](./ci/01-flujos.md) (`R-CI`) reescrito | [`ci.yml`](../../.github/workflows/ci.yml) tiene **2 jobs** (`build-test-lint` + `integration`) y hay un workflow `e2e.yml` de release. |
| `develop` → `staging` → `main` con Dockploy | [`git/00-entornos.md`](./git/00-entornos.md) (`R-GE`) reescrito | El repo tiene **una sola rama `main`**. La promoción a dos entornos queda como deuda explícita, no como norma vigente. |
| `infra/db/init/*.sql` | [`db/01-database.md`](./db/01-database.md) (`R-DB-6`) reescrito | El esquema vive en migraciones de Prisma (`prisma/migrations/`). |

Los sufijos `R-GW`, `R-MS`, `R-MI` y `R-SB` quedan **retirados y nunca se reutilizan**
(como todas las reglas, un ID no vuelve a usarse; ver convención 2).

El área [`test/`](./test/README.md) es el ejemplo canónico al que apuntan las demás: es
la que refleja mejor la diferencia entre "regla heredada" y "regla de este repo".
