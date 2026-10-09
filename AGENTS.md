# AGENTS.md

Guía para agentes de IA que trabajen en **ai-scraping-executor**. Monorepo npm workspaces
(`apps/*` + `packages/*`), TypeScript, Node ≥20 (la CI y las imágenes usan 22), runner
nativo `node --test` (no Vitest/Jest).

`LA IA ES EL CEREBRO. CRAWLEE ES EL MOTOR.` La IA decide QUÉ (DSL de 15 comandos); el motor decide CÓMO.

## Punto fijo normativo (leer antes de cambiar)

- [`docs/rules/`](docs/rules/README.md) son las reglas permanentes (IDs `R-*` y gates `G-*`,
  inmutables) y [`docs/rules/_meta/AUDIT.md`](docs/rules/_meta/AUDIT.md) el estado y deudas
  actuales. Antes de un cambio: leer el índice, el área que tocas y el AUDIT (`R-AC-1`).
- Decisiones estructurales (herramienta, esquema, orden de build) → ADR en `docs/decisiones.md`.
  Un ID de regla nunca se renombra ni reutiliza.
- Un gate solo está ✅ con evidencia ejecutable (run verde), nunca por estar "configurado".

## Comandos esenciales

```bash
npm install                    # instalar (si algún día hay conflicto de peers: --legacy-peer-deps)

npm run build                  # compila TODO en orden de dependencias (packages → apps)
npm run build:core             # solo packages base (sin apps)
npm run lint                   # eslint apps packages scripts (debe quedar 0 errors/0 warnings)
npm run typecheck              # alias de build
npm test                       # 153 tests unitarios + propiedades (mocks, sin BD reales)
MONGODB_MOCK=1 npm test        # fuerza mock MongoDB (recomendado en local sin Docker)
npm run test:contract          # contrato de la API /api/v1 (G-5), sin infra
npm run test:integration       # integración con Postgres/Mongo/Redis reales (G-4)
npm run openapi:check          # verifica que docs/openapi.json está en sync (G-8)
npm run test:repeat -- 5       # detecta tests intermitentes (lento; NO es gate de PR)

# E2E real (requiere Docker up + .env con OPENROUTER_API_KEY + Playwright Chromium en host)
npx playwright install --with-deps chromium   # una sola vez en host
npm run dev:e2e                # levanta BDs + migra + build + test E2E
npm run test:e2e               # solo el E2E (carga .env con --env-file-if-exists)

# Cliente real de la API (Node, universal). Requiere API up. Ver scripts/README.md
npm run test:api               # todos los flujos (chat/sesiones, jobs, radiografía, errores)
npm run test:api:fast          # sin flujos con radiografía/job real

# Infra
docker compose up -d postgres mongodb redis
npm run prisma:migrate:deploy  # aplicar migraciones (prod/CI)
npm run prisma:generate        # regenerar cliente Prisma
npm run dev:api                # API :3000
npm run dev:worker             # worker (cola BullMQ, o DEMO_URL)
```

## Antes de dar una tarea por terminada

Siempre ejecutar y dejar verdes:

```bash
npm run build && npm run lint && MONGODB_MOCK=1 npm test
```

`lint` debe reportar **0 errors y 0 warnings** (el alcance incluye `scripts/`; por eso
`@typescript-eslint/no-explicit-any` y `no-unused-vars` son warnings que rompen el gate).
`npm test` falla **también si baja la cobertura** (líneas 70 / ramas 72 / funciones 67):
código nuevo sin test tumba el gate.
Antes del push conviene además `npm run test:contract` (sin infra), `npm run openapi:check`
y `npm audit --audit-level=high` (R-QA-6: 0 vulnerabilidades); con Docker, `npm run test:integration`.
No commitear ni hacer push salvo que el usuario lo pida explícitamente.

## Git y PR (solo cuando el usuario lo pida)

- El repo tiene **una sola rama `main`**, historia lineal (0 merges). Se trabaja en rama
  semántica (`tipo/ámbito-descripción`) + PR; nunca commit directo a `main`. Merge por
  `--rebase` (nunca `--squash` ni merge commit). Stage con rutas explícitas.
- Conventional Commits en español e imperativo, una unidad temática por commit.
- Checklist de PR: [`docs/rules/_meta/CHECKLIST.md`](docs/rules/_meta/CHECKLIST.md).

## Arquitectura (dónde vive cada cosa)

> **Objetivo (ADR-27/ADR-30): migración a arquitectura hexagonal** —
> `apps/*` como composition root sobre `libs/{domain,application,infrastructure,shared}`.
> Plan y mapeo: [`docs/migracion-arquitectura.md`](docs/migracion-arquitectura.md).
> Reglas canónicas: [`docs/rules/architecture/03-arquitectura-hexagonal.md`](docs/rules/architecture/03-arquitectura-hexagonal.md)
> (`R-HX-*`). **La migración aún no se ha ejecutado**: el código sigue en `packages/`.
> En este paso, la entrega es **documentación y reglas**, no mover código.

```
apps/api        NestJS: /jobs /radiography /sessions /metrics /dashboard /health (prefijo /api/v1)
apps/worker     AgentRunner (planner + loop Observe→Think→Act + recovery), browser-engine, job-processor

libs/shared/core          utilidades puras (hashHtml)
libs/domain/execution     JobStatus/JobLimits/DEFAULT_LIMITS/normalizeJobLimits (fuente única)
libs/domain/scraper       TracedValue/StructuredItem (trazabilidad)
packages/commands         DSL Zod (schemas.ts) + CommandValidator (validator.ts) + normalize.ts
packages/crawler          CrawlerService (CheerioCrawler/PlaywrightCrawler hybrid, interact())
packages/execution-engine ExecutionEngine (HTTP/Cheerio + browserInteract), PageCache
packages/ai               AIOrchestrator, prompts, context-builder
packages/ai-providers     OpenRouterProvider (fallback modelos), Custom, FallbackAIProvider
packages/mongodb          SiteProfile/PageRadiography, MongoRepository, performRadiography/getLearnedProfile
packages/redis            RedisPageCache/RedisRateLimiter/RedisMetricsAggregator (fallback memoria)
packages/queue            JobQueue (BullMQ + InMemory)
packages/security         SSRF centralizado: assertPublicUrl/isBlockedHost/createAllowlist
packages/storage          JobStore (Prisma + InMemory)

libs/shared/observability logger JSON + MetricsCollector (Prometheus)  # migrado desde packages/ (ADR-30)
```

## Reglas del proyecto (importantes)

1. **Build order**: `packages/security` y `core` primero; `tsconfig.base.json` mapea `paths` a
   `packages/*/dist` y `libs/*/*/dist` (NO a `src`). Cada paquete/lib tiene su propio `tsconfig.json`
   con `rootDir: src` y `outDir: dist`. Los tests cargan `dist/`, así que edita TS y **rebuild** antes de testear.
2. **Seguridad**: toda validación de URL pasa por `@ai-scraper/security` (`assertPublicUrl`). La IA nunca
   ejecuta código arbitrario. SSRF/allowlist en `CommandValidator`. No duplicar lógica SSRF.
3. **DSL**: los 15 comandos están en `packages/commands/src/schemas.ts` (Zod). La IA solo emite estos.
   Los modelos débiles se corrigen en `normalize.ts` ANTES de validar; la validación sigue estricta.
4. **Trazabilidad §33**: cada item extraído lleva `_source { url, selector, scrapedAt }`.
5. **Fallbacks**: Mongo/Redis/Prisma tienen fallback en memoria avisado por log. Nunca fallar en silencio.
6. **OpenRouter**: `OPENROUTER_MODEL` + `OPENROUTER_FALLBACK_MODELS`; salta de modelo solo en 404/429.
   Modelos free cambian → usar `openrouter/free` o IDs `:free` actuales. Alternativa: Ollama (`AI_PROVIDER=custom`).
7. **No añadir comentarios** al código salvo que aporten contexto no obvio. Estilo: TS estricto, sin `any` nuevo.
8. **Artefactos**: no dejar `.js/.d.ts/.map` dentro de `src/` (los genera un `tsc` mal ejecutado y rompen el lint).
   El lint ignora `**/dist/**`, pero no `src/*.js`.
9. **OpenAPI**: si cambias un DTO o una ruta, ejecuta `npm run openapi:export` y commitea
   `docs/openapi.json`; el gate `G-8` (`openapi:check`) falla si no está en sync.
10. **Migraciones**: si tocas `prisma/schema.prisma`, añade la migración en `prisma/migrations/`;
    `G-9` corre `prisma validate` + `migrate deploy` + `migrate diff --exit-code`.
11. **Arquitectura hexagonal (R-HX)**: el destino es `libs/{domain,application,infrastructure,shared}`
    (objetivo) con `apps/*` como composition root; hoy el código sigue en `packages/` (migración
    strangler, ADR-30). `npm run lint` incluye `npm run boundaries:check`
    (`scripts/check-boundaries.mjs`), que **falla** ante una arista prohibida de `R-HX-2`. No añadas
    dependencias sin comprobar `npm audit` (0 vulnerabilidades, `R-QA-6`).

## Testing

- Runner: `node --test` con `--test-concurrency=1` (Crawlee usa storage local; paralelo causa flakiness).
- `npm test` **no** toca red, BD real ni LLM: todo doblado (`R-QA-2`); usa `http.createServer` local,
  proveedor LLM falso y `MONGODB_MOCK=1`.
- El smoke de Prisma corre **solo** si `DATABASE_URL` responde; sin Docker se salta (esperado).
- Tests por área en `tests/*.test.mjs`; el E2E real es `tests/e2e-sevasa.test.mjs` (no está en `npm test`).
- Funciones puras (DSL, límites, dominios) deben traer su propiedad en `tests/property.test.mjs`.

## Entorno

- `.env` está en `.gitignore` y `.dockerignore` — **nunca** commitear secretos. Solo `.env.example`
  y `.env.production.example`. Si añades una variable, actualiza ambos (`R-DO-3`).
- `test:e2e` usa `node --env-file-if-exists=.env`, por eso no hace falta exportar variables manualmente.
- **URL de pruebas estándar**: `TEST_URL=https://negocio360oficial.com/dashboard.html` (usada por
  `npm run test:api` y todos los flujos de validación MVP). El E2E usa `https://www.sevasaonline.com/`.
- Dockerfiles usan `npm ci --ignore-scripts` (sin `--legacy-peer-deps`: Nest 12 y eslint 10 alinearon los peers; ver ADR-18).
- CI (`.github/workflows/`): `ci.yml` (jobs `build-test-lint` + `integration`) corre en push a `main` y en PR;
  `e2e.yml` en `release`; `release.yml` en tag `v*.*.*`. Los comandos del workflow deben ser reproducibles en local.

## Gotchas conocidos

- Si `tsc` se ejecuta sin `-p packages/<x>/tsconfig.json`, puede emitir `.js` junto al `.ts` → romperá lint.
  Solución: `npm run build -w <paquete>` y borrar artefactos de `src/`.
- Tras mover código entre paquetes, actualizar imports (`@ai-scraper/...`) y hacer `rm -rf <dist>` + rebuild.
- Modelos OpenRouter 404 = deprecated/no disponible; 403 = sin créditos/límite; 429 = rate limit (el fallback salta).
