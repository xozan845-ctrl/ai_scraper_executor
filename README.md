# AI Web Scraping Executor — v0.6 (FASE 0–10 completas, MVP funcional)

Plataforma agnóstica de scraping asistida por IA. `LA IA ES EL CEREBRO. CRAWLEE ES EL MOTOR.` (§67)

## Arquitectura (5 capas §65)

```
INTERFACE (API NestJS) -> ORCHESTRATION (Jobs/Redis) -> INTELLIGENCE (AI Planner/OpenRouter|Custom)
 -> EXECUTION (DSL/Crawlee/Playwright) -> DATA (Postgres/Redis)
```

## Quickstart

```bash
cp .env.example .env
npm install
docker compose up -d postgres redis
npm run dev:api     # POST /api/v1/jobs
npm run dev:worker  # DEMO_URL=https://example.com npm run dev:worker
```

## API (§42)

```bash
POST /api/v1/jobs {"url":"https://example.com","instruction":"Obtén todos los productos"}
GET  /api/v1/jobs/:id
GET  /api/v1/jobs/:id/results
GET  /api/v1/jobs/:id/execution
POST /api/v1/jobs/:id/cancel
```

## Estructura (§43)

```
apps/api apps/worker packages/{core,crawler,commands,execution-engine,ai,ai-providers,schemas,storage,queue,security,observability} prisma/ docker/
```

## Principios (§64)

1. AI reemplazable, OpenRouter por defecto, custom endpoint soportado.
2. Crawlee es el core de ejecución. HTTP preferido, Browser cuando se requiera.
3. Comandos fuertemente tipados; la IA no ejecuta código arbitrario.
4. Seguridad fuera de la IA: validator + SSRF + allowlist.
5. Trazabilidad: cada dato -> {url, selector, scrapedAt, confidence}.

## Roadmap (§61)

- [x] FASE 0 Arquitectura
- [x] FASE 1 Crawlee Core (`CrawlerService.crawlDetailed/inspectSinglePage`: hybrid HTTP→Browser, RequestQueue fresca por ejecución, SessionPool, reintentos, heurística agnóstica de elementos, SSRF §37)
- [x] FASE 2 Command Engine (`ExecutionEngine` HTTP/Cheerio real: NAVIGATE, INSPECT_*, EXTRACT, EXTRACT_LIST con trazabilidad §33, FOLLOW_LINKS, PAGINATE por pattern/selector, CLICK-enlace; CLICK-JS/SCROLL devuelven `needsBrowser` para escalar a Playwright)
- [x] FASE 3 AI Provider Layer (cliente OpenAI-compatible con timeout+retry 429/5xx+backoff, `OpenRouterProvider` §15, `CustomEndpointProvider` §16 Ollama/vLLM/LM Studio, modelo por job §18 `opts.model > context.model > config`, `FallbackAIProvider` §19, `AIOrchestrator` §20 con reenvío de opts + callCount/lastStats, stats `latencyMs/tokens/model` para §56)
- [x] FASE 4 AI Planner (`apps/worker/src/planner.ts`: instrucción → `ScrapingPlan` validado, NAVIGATE inicial garantizado, PAGINATE/FOLLOW_LINKS/EXTRACT_LIST recortados a límites §35, modelo por job §18)
- [x] FASE 5 Agent Loop (`apps/worker/src/agent-runner.ts`: plan + bucle dinámico Observe→Think→Act §47, contexto reducido §23, acotado por maxSteps/maxItems, `needsBrowser` sugiere escalar a Playwright §34)
- [x] FASE 6 Recovery (alternativa del LLM ante fallo de validación/ejecución §28, `recoveryCount` para AI Recovery Rate §56, FAILED explicativo sin reintentos infinitos ni evasión de controles §60)
- [x] FASE 7 Persistencia (`@ai-scraper/storage`: `JobStore` + `PrismaJobStore` PostgreSQL §11/§40 con migración inicial + `InMemoryJobStore`; `@ai-scraper/queue`: `BullMQJobQueue` Redis §12 con reintentos/backoff + `InMemoryJobQueue`; factorías con fallback avisado; `processJob` persiste estados/plan/comandos/páginas/resultados/errores/interacciones IA con tokens/latencia §56)
- [x] FASE 8 API real (NestJS: `POST/GET /jobs`, `GET /:id/results|/execution`, `POST /:id/cancel` contra DB+cola; cancel terminal seguro; enqueue fallido → FAILED sin jobs fantasma)
- [x] FASE 9 Dashboard (`GET /api/v1/dashboard`: SPA sin build — métricas, alta de jobs, tabla con estados, detalle con comandos/páginas/resultados/errores/decisiones IA con auto-refresh; `GET /jobs/:id/ai` para llamadas LLM por job)
- [x] FASE 10 Escala y observabilidad (`@ai-scraper/observability`: log JSON por niveles §38 + collector con exposition Prometheus §56; `GET /metrics` con stats DB + `aiRecoveryRate`; `CRAWLEE_MAX_REQUESTS_PER_MINUTE` §36; workers stateless escalables con `docker compose up --scale worker=N` + `WORKER_CONCURRENCY`)
```

## Tests

```bash
npm test   # node --test: dsl + engine + crawler + ai-providers + agent + persistence + dashboard/metrics = 50 tests
             # (el smoke Prisma se ejecuta solo con DATABASE_URL válido; sin él hace SKIP explícito)
ALLOW_PRIVATE_HOSTS=1  # solo tests/e2e locales; en prod el SSRF sigue bloqueado
```

## Persistencia y cola (FASE 7)

```bash
cp .env.example .env
docker compose up -d postgres redis
npx prisma migrate dev   # aplica prisma/migrations/0_init (8 tablas §40)
npm run dev:api          # Prisma si responde, si no memoria (avisado en log)
npm run dev:worker       # BullMQ si responde, si no idle/DEMO_URL
```

Sin Docker el sistema arranca igual con stores/colas en memoria (los datos no
persisten; el log lo indica). El daemon Docker de este entorno no está activo,
así que la verificación contra Postgres/Redis reales queda pendiente de un
entorno con Docker; el test condicional la ejecutará automáticamente allí.

MVP aceptado cuando cumpla §63 A–O.
