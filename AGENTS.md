# AGENTS.md

Guía para agentes de IA que trabajen en **ai-scraping-executor**. Monorepo npm workspaces
(`apps/*` + `packages/*`), TypeScript, Node ≥20.6, Vitest no: usa el runner nativo `node --test`.

`LA IA ES EL CEREBRO. CRAWLEE ES EL MOTOR.` La IA decide QUÉ (DSL de 15 comandos); el motor decide CÓMO.

## Comandos esenciales

```bash
npm install                    # instalar (si algún día hay conflicto de peers: --legacy-peer-deps)

npm run build                  # compila TODO en orden de dependencias (packages → apps)
npm run build:core             # solo packages base (sin apps)
npm run lint                   # eslint apps packages scripts (debe quedar en 0 errors/0 warnings)
npm run typecheck              # alias de build
npm test                       # 153 tests unitarios + propiedades (mocks, sin BD reales)
MONGODB_MOCK=1 npm test        # fuerza mock MongoDB (recomendado en local sin Docker)
npm run test:contract          # contrato de la API /api/v1 (G-5), sin infra
npm run test:integration       # integración con Postgres/Mongo/Redis reales (G-4)

# E2E real (requiere Docker up + .env con OPENROUTER_API_KEY + Playwright Chromium en host)
npx playwright install --with-deps chromium   # una sola vez en host
npm run dev:e2e                # levanta BDs + migra + build + test E2E
npm run test:e2e               # solo el E2E (env con --env-file-if-exists=.env)

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

`lint` debe reportar **0 errors y 0 warnings**. Antes del push también conviene
`npm run test:contract` (sin infra) y, con Docker, `npm run test:integration`.
No commitear ni hacer push salvo que el usuario lo pida explícitamente.

## Arquitectura (dónde vive cada cosa)

```
apps/api        NestJS: /jobs /radiography /metrics /dashboard /health (prefijo /api/v1)
apps/worker     AgentRunner (planner + loop Observe→Think→Act + recovery), browser-engine, job-processor

packages/core             JobStatus/JobLimits/TracedValue (fuente única de tipos)
packages/commands         DSL Zod (schemas.ts) + CommandValidator (validator.ts) + normalize.ts
packages/crawler          CrawlerService (CheerioCrawler/PlaywrightCrawler hybrid, interact())
packages/execution-engine ExecutionEngine (HTTP/Cheerio + browserInteract), PageCache
packages/ai               AIOrchestrator, prompts, context-builder
packages/ai-providers     OpenRouterProvider (fallback modelos), Custom, FallbackAIProvider
packages/mongodb          SiteProfile/PageRadiography, MongoRepository, performRadiography/getLearnedProfile
packages/redis            RedisPageCache/RedisRateLimiter/RedisMetricsAggregator (fallback memoria)
packages/queue            JobQueue (BullMQ + InMemory)
packages/security         SSRF centralizado: assertPublicUrl/isBlockedHost/createAllowlist
packages/observability    logger JSON + MetricsCollector (Prometheus)
packages/storage          JobStore (Prisma + InMemory)
```

## Reglas del proyecto (importantes)

1. **Build order**: `packages/security` y `core` primero; `tsconfig.base.json` mapea `paths` a `packages/*/dist`
   (NO a `src`). Cada paquete tiene su propio `tsconfig.json` con `rootDir: src` y `outDir: dist`.
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

## Testing

- Runner: `node --test` con `--test-concurrency=1` (Crawlee usa storage local; paralelo causa flakiness).
- Todo mockeado: `fetch`, LLM (fake provider), `http.createServer` local, `MONGODB_MOCK=1`.
- El smoke de Prisma corre **solo** si `DATABASE_URL` responde; sin Docker se salta (esperado).
- Tests por área en `tests/*.test.mjs`; el E2E real es `tests/e2e-sevasa.test.mjs` (no está en `npm test`).

## Entorno

- `.env` está en `.gitignore` y `.dockerignore` — **nunca** commitear secretos. Solo `.env.example`.
- `test:e2e` usa `node --env-file=.env`, por eso no hace falta exportar variables manualmente.
- **URL de pruebas estándar**: `TEST_URL=https://negocio360oficial.com/dashboard.html` (usada por `npm run test:api` y todos los flujos de validación MVP).
- Dockerfiles usan `npm ci --ignore-scripts` (sin `--legacy-peer-deps`: Nest 12 y eslint 10 alinearon los peers; ver ADR-18).

## Gotchas conocidos

- Si `tsc` se ejecuta sin `-p packages/<x>/tsconfig.json`, puede emitir `.js` junto al `.ts` → romperá lint.
  Solución: `npm run build -w <paquete>` y borrar artefactos de `src/`.
- Tras mover código entre paquetes, actualizar imports (`@ai-scraper/...`) y hacer `rm -rf <dist>` + rebuild.
- Modelos OpenRouter 404 = deprecated/no disponible; 403 = sin créditos/límite; 429 = rate limit (el fallback salta).
