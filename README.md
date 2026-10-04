# AI Web Scraping Executor — v0.13 (FASE 0–13 completas, MVP funcional + Memoria + Redis + E2E)

Plataforma agnóstica de scraping asistida por IA. `LA IA ES EL CEREBRO. CRAWLEE ES EL MOTOR.`

## Arquitectura (5 capas)

```
INTERFACE (API NestJS) -> ORCHESTRATION (Jobs/Redis/BullMQ) -> INTELLIGENCE (AI Planner/OpenRouter|Custom|Ollama)
  -> EXECUTION (DSL/Crawlee/Playwright) -> DATA (PostgreSQL + MongoDB + Redis)
```

## Quickstart

```bash
# 1. Clonar y configurar entorno
cp .env.example .env
# Edita .env con tus claves (OPENROUTER_API_KEY, etc.)

# 2. Instalar dependencias
npm install

# 3. Levantar infraestructura (PostgreSQL + MongoDB + Redis)
docker compose up -d postgres mongodb redis

# 4. Migraciones Prisma (PostgreSQL)
npm run prisma:migrate:deploy

# 5. Build completo
npm run build --workspaces

# 6. Desarrollo
npm run dev:api     # API en :3000
npm run dev:worker  # Worker consumiendo cola
```

## Tests

```bash
# Tests unitarios/integración (mocks, sin BD reales)
npm test                    # 73 tests: dsl + engine + crawler + ai-providers + agent + persistence + dashboard + security + browser + api-hardening + observability + scale
MONGODB_MOCK=1 npm test     # Forzar mock MongoDB

# Test E2E real contra https://www.sevasaonline.com/
# Requiere: Docker (postgres+mongodb+redis) + OPENROUTER_API_KEY + Playwright Chromium en host
# ⚠️ Para E2E local (fuera de Docker): `npx playwright install --with-deps chromium`
npm run dev:e2e
# O manual:
docker compose up -d postgres mongodb redis
npm run prisma:migrate:deploy
npm run build --workspaces
OPENROUTER_API_KEY=sk-xxx npm run test:e2e
```

**Variables de test:**
- `ALLOW_PRIVATE_HOSTS=1` — permite localhost/127.0.0.1 en tests (SSRF sigue bloqueado en prod)
- `MONGODB_MOCK=1` — usa MongoDB en memoria en tests unitarios

## Variables de Entorno (`.env`)

**⚠️ NUNCA commitear `.env` — está en `.gitignore` y `.dockerignore`. Solo `.env.example` se sube al repo.**

| Variable | Descripción | Default |
|---|---|---|
| `NODE_ENV` | Entorno | `development` |
| `LOG_LEVEL` | `debug\|info\|warn\|error` | `info` |
| `PORT` | Puerto API | `3000` |
| `DATABASE_URL` | PostgreSQL | `postgresql://scraper:scraper@localhost:5432/scraper` |
| `MONGODB_URI` | MongoDB | `mongodb://localhost:27017/scraper` |
| `MONGODB_DB` | DB MongoDB | `scraper` |
| `REDIS_URL` | Redis | `redis://localhost:6379` |
| `OPENROUTER_API_KEY` | Clave OpenRouter | **requerida para LLM** |
| `OPENROUTER_MODEL` | Modelo | `anthropic/claude-3.5-sonnet` |
| `AI_PROVIDER` | `openrouter\|custom` | `openrouter` |
| `AI_CUSTOM_ENDPOINT` | Endpoint custom (Ollama/vLLM) | - |
| `AI_CUSTOM_API_KEY` | API key custom | - |
| `AI_CUSTOM_MODEL` | Modelo custom | - |
| `AI_TEMPERATURE` | Temperatura LLM | `0.1` |
| `AI_MAX_TOKENS` | Max tokens | `4000` |
| `AI_TIMEOUT_MS` | Timeout LLM | `60000` |
| `CRAWLEE_HEADLESS` | Browser headless | `true` |
| `CRAWLEE_MAX_CONCURRENCY` | Concurrencia Crawlee | `5` |
| `CRAWLEE_MAX_REQUESTS_PER_MINUTE` | Rate limit Crawlee | - |
| `WORKER_CONCURRENCY` | Jobs paralelos por worker | `2` |
| `PAGE_CACHE_TTL_MS` | TTL cache páginas | `300000` |
| `PAGE_CACHE_MAX_ENTRIES` | Max entradas cache | `100` |
| `API_KEYS` | Claves API (coma-sep) | - (sin auth) |
| `ALLOWED_DOMAINS` | Dominios permitidos | - (todos) |
| `RATE_LIMIT_CREATE_PER_MIN` | Rate limit POST /jobs | `30` |
| `INSTANCE_ID` | ID réplica métricas | `hostname-pid` |

## Estructura del Proyecto

```
apps/
  api/           # NestJS API REST (POST/GET /jobs, /radiography, /metrics, /dashboard)
  worker/        # Procesador de jobs (AgentRunner + browser-engine)
packages/
  core/          # Tipos compartidos (JobStatus, JobLimits, TracedValue)
  commands/      # DSL Zod (13 comandos) + CommandValidator (SSRF + allowlist)
  crawler/       # CrawlerService (CheerioCrawler + PlaywrightCrawler, hybrid, SessionPool)
  execution-engine/  # ExecutionEngine (HTTP/Cheerio + delegado browser CLICK/SCROLL)
  ai/            # AIOrchestrator + prompts + context-builder
  ai-providers/  # OpenRouterProvider, CustomEndpointProvider, FallbackAIProvider
  mongodb/       # SiteProfile, PageRadiography, MongoRepository (fallback memoria)
  redis/         # RedisPageCache, RedisRateLimiter, RedisMetricsAggregator (fallback memoria)
  queue/         # BullMQJobQueue + InMemoryJobQueue
  security/      # SSRF centralizado (assertPublicUrl, isBlockedHost, createAllowlist)
  observability/ # Logger JSON + MetricsCollector (Prometheus)
  storage/       # JobStore (Prisma + InMemory)
  schemas/       # Stub Zod API (reservado)
  queue/         # JobQueue interface + factory
prisma/
  schema.prisma  # 8 tablas: User, Job, ScrapingPlan, Command, Page, Result, JobError, AIInteraction
docker/
  Dockerfile.api # Alpine + HEALTHCHECK
  Dockerfile.worker # Bookworm-slim + Playwright Chromium
```

## API Endpoints

### Jobs
```
POST   /api/v1/jobs                    # Crear job {url, instruction, limits?, ai?, priority?}
GET    /api/v1/jobs?limit=20           # Listar jobs
GET    /api/v1/jobs/:id                # Detalle job
GET    /api/v1/jobs/:id/results        # Items extraídos (con _source tracing)
GET    /api/v1/jobs/:id/execution      # Comandos + páginas + errores
GET    /api/v1/jobs/:id/ai?limit=50    # Interacciones LLM (paginado)
POST   /api/v1/jobs/:id/cancel         # Cancelar (terminal seguro)
```

### Radiografía / Memoria (FASE 12)
```
POST   /api/v1/radiography             # Radiografía real {url, maxDepth?, maxPages?, forceBrowser?}
GET    /api/v1/radiography/profile/:domain           # Perfil aprendido
GET    /api/v1/radiography/profile/:domain/selectors # Selectores listos para usar
GET    /api/v1/radiography/page/:url                 # Radiografía cacheada
GET    /api/v1/radiography/domain/:domain/stats      # Stats agregadas
```

### Métricas / Observabilidad
```
GET    /api/v1/metrics                 # JSON (stats DB + process + aiRecoveryRate)
GET    /api/v1/metrics/prometheus      # Prometheus text exposition (con label `instance`)
GET    /api/v1/health                  # Health check
GET    /api/v1/dashboard               # SPA dashboard (auto-refresh 5s)
```

## Autenticación y Rate Limiting

- **API Key**: header `x-api-key` o query `?apiKey=` (config `API_KEYS` en `.env`). Sin claves = abierto (dev).
- **Allowlist dominios**: `ALLOWED_DOMAINS=tienda.com,otro.com` — bloquea jobs fuera de lista.
- **Rate limit**: `RATE_LIMIT_CREATE_PER_MIN=30` por IP en `POST /jobs` (headers `X-RateLimit-*`).

## Despliegue en Producción

### Docker Compose (recomendado)

```yaml
# docker-compose.yml ya incluido
docker compose up -d postgres mongodb redis migrate api worker
# Escala workers: docker compose up --scale worker=3
```

**Servicios:**
- `postgres:16-alpine` — datos persistentes (jobs, planes, resultados)
- `mongodb:7-jammy` — memoria/perfiles (SiteProfile, PageRadiography)
- `redis:7-alpine` — cola BullMQ + cache páginas + rate-limit + métricas distribuidas
- `migrate` — one-shot `prisma migrate deploy` (nunca `dev` en prod)
- `api` — NestJS compilado (`npm run start`), healthcheck `/health`, restart `unless-stopped`
- `worker` — Chromium real (Playwright), `WORKER_CONCURRENCY`, escala `--scale worker=N`

### Build Images

```bash
# API
docker build -f apps/api/Dockerfile -t ai-scraper-api .

# Worker (con Chromium)
docker build -f apps/worker/Dockerfile -t ai-scraper-worker .
```

### Variables obligatorias en prod

```bash
# .env.prod
NODE_ENV=production
LOG_LEVEL=info
DATABASE_URL=postgresql://user:pass@host:5432/db
MONGODB_URI=mongodb://user:pass@host:27017/db
REDIS_URL=redis://user:pass@host:6379
OPENROUTER_API_KEY=sk-xxx
API_KEYS=prod-key-1,prod-key-2
ALLOWED_DOMAINS=tudominio.com
RATE_LIMIT_CREATE_PER_MIN=60
```

## Flujo de Trabajo (Job Lifecycle)

```
1. POST /jobs {url, instruction, limits, ai, priority}
   -> valida SSRF + allowlist -> crea Job QUEUED -> encola en BullMQ

2. Worker (BullMQ) consume job
   -> AgentRunner.run(job)
   -> FASE 12: getLearnedProfile(url) -> perfil MongoDB (selectores, needsBrowser)
   -> FASE 4: generatePlan() -> inyecta learnedProfile al LLM -> plan validado
   -> FASE 5: Fase A (plan) + Fase B (Observe→Think→Act loop)
   -> FASE 3: CLICK/SCROLL -> CrawlerService.interact() (Chromium real)
   -> FASE 6: Recovery automático (max 2 intentos)
   -> FASE 11: PageCache (Redis) + dedupe URLs + prioridades

3. Persistencia (PostgreSQL via Prisma)
   -> Job, ScrapingPlan, Command, Page, Result, JobError, AIInteraction
   -> FASE 12: recordJobResult() -> actualiza SiteProfile stats

4. Resultados
   -> GET /jobs/:id/results -> items con _source{url,selector,scrapedAt,confidence}
   -> GET /jobs/:id/ai -> llamadas LLM con tokens/latencia
```

## Métricas y Observabilidad

- **Logs**: JSON estructurado (`{ts,level,msg,instance,jobId,provider,...}`) — Loki/ELK ready
- **Métricas proceso**: `MetricsCollector` (counters/gauges) + `GET /metrics` + Prometheus
- **Métricas distribuidas (Redis)**: `RedisMetricsAggregator` — `sum by (instance)` en Grafana
- **Dashboards**: `GET /dashboard` (SPA auto-refresh) + Grafana (importar `metrics:prometheus`)

## Seguridad

- **SSRF centralizado** (`@ai-scraper/security`): `assertPublicUrl`, `isBlockedHost`, `createAllowlist`
- **Allowlist por job**: dominio fijado al crear job, IA no puede escalar
- **DSL tipado**: 13 comandos Zod — la IA **nunca** ejecuta código arbitrario
- **Rate limits**: API + Crawlee (`CRAWLEE_MAX_REQUESTS_PER_MINUTE`)
- **Sanitización**: HTML >2MB rechazado, timeout 20s, UA propio

## Desarrollo Local

```bash
# Con Docker (BDs reales)
docker compose up -d postgres mongodb redis
npm run dev:api
npm run dev:worker

# Sin Docker (memoria)
npm run dev:api        # InMemoryJobStore + InMemoryJobQueue
npm run dev:worker     # DEMO_URL=https://example.com npm run dev:worker

# Lint + Typecheck
npm run lint
npm run typecheck
```

## Troubleshooting

| Problema | Solución |
|---|---|
| `MongooseServerSelectionError` | Levantar MongoDB: `docker compose up -d mongodb` |
| `ECONNREFUSED redis` | Levantar Redis: `docker compose up -d redis` |
| Jobs se quedan QUEUED | Verificar worker corriendo + `REDIS_URL` correcto |
| `playwright: executable doesn't exist` | `npx playwright install --with-deps chromium` (en worker Dockerfile ya está; para E2E local fuera de Docker, ejecutar en host) |
| Tests fallan por flakiness | `npm test` usa `--test-concurrency=1` |
| Radiografía lenta | Forzar `forceBrowser: true` si sitio es JS-heavy |

## Contribuir

```bash
git checkout -b feature/x
# Cambios + tests
npm run lint && npm test && npm run build --workspaces
git push && PR
```

---

**Licencia**: MIT — Úsalo, modifícalo, rómpelo, arréglalo.