# AI Web Scraping Executor — v0.14 (FASE 0–13 + Memoria MongoDB + Redis distribuido + IA real E2E)

Plataforma agnóstica de scraping asistida por IA. `LA IA ES EL CEREBRO. CRAWLEE ES EL MOTOR.`

> Estado: **MVP funcional validado E2E contra una web real** (`https://www.sevasaonline.com/`) con LLM
> (incluidos modelos free de OpenRouter) extrayendo datos, memoria persistente (MongoDB) y caché Redis.

## Arquitectura

**Objetivo (ADR-27): arquitectura hexagonal por dominios** — `apps/*` (composition
root) sobre `libs/{domain,application,infrastructure,shared}`. El plan, el mapeo de
`packages/` → `libs/` y las fases viven en
[`docs/migracion-arquitectura.md`](docs/migracion-arquitectura.md); las reglas
canónicas en [`docs/rules/architecture/03-arquitectura-hexagonal.md`](docs/rules/architecture/03-arquitectura-hexagonal.md).

**Estado actual:** la migración estructural a `libs/` está **completada** (`packages/`
retirado); el runtime sigue describiéndose con la vista de 5 capas. Queda **F5**:
adoptar Vitest como runner (ADR-29).

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
npm run build

# 6. Desarrollo
npm run dev:api     # API en :3000
npm run dev:worker  # Worker consumiendo cola
```

## Tests

```bash
# Tests unitarios/integración (mocks, sin BD reales)
npm test                    # 153 tests (28 suites): dsl + dsl-completeness + normalize + engine + crawler + ai-providers + agent + persistence + dashboard + security + browser + api-hardening + observability + scale + llm-cache + interpret + resilience + sessions + credentials + cache-isolation + limits + first-user + logging + util-unify + metrics-labels + retry-cleanup + browser-ssrf + property
MONGODB_MOCK=1 npm test     # Forzar mock MongoDB

# Test E2E real contra https://www.sevasaonline.com/
# Requiere: Docker (postgres+mongodb+redis) + OPENROUTER_API_KEY en .env + Playwright Chromium en host
# ⚠️ Para E2E local (fuera de Docker): `npx playwright install --with-deps chromium`
npm run dev:e2e             # levanta BDs + migra + build + test
npm run test:e2e            # solo el test (carga .env automáticamente vía node --env-file)

# Cliente real de la API (Node, universal macOS/Windows/Linux). Requiere API + worker up.
# Ver scripts/README.md para TEST_HEADERS_JSON y TEST_PROMPTS_JSON.
npm run test:api            # todos los flujos, incluido chat real y credenciales
npm run test:api:fast       # solo los rápidos (sin radiografía/job/chat real)
```

> `test:e2e` usa `node --env-file=.env` (Node ≥20.6), así que la `OPENROUTER_API_KEY` y los modelos
> se toman del `.env` sin exportarlos manualmente.
> `test:api` (en `scripts/`) es un **cliente real**: recorre todos los endpoints y verifica que un
> frontend tipo chat pueda funcionar. Configura `API_URL`, `API_KEY`, `TEST_URL`,
> `TEST_HEADERS_JSON` (credenciales opcionales) y `TEST_PROMPTS_JSON` (conversación continua).

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
| `OPENROUTER_MODEL` | Modelo principal | `openrouter/free` |
| `OPENROUTER_FALLBACK_MODELS` | Modelos alternativos (coma-sep), se usan ante 404/429 | lista de `:free` |
| `OPENROUTER_BASE_URL` | Base URL API | `https://openrouter.ai/api/v1` |
| `AI_PROVIDER` | `openrouter\|custom` | `openrouter` |
| `AI_CUSTOM_ENDPOINT` | Endpoint custom (Ollama/vLLM) | - |
| `AI_CUSTOM_API_KEY` | API key custom | - |
| `AI_CUSTOM_MODEL` | Modelo custom | - |
| `AI_TEMPERATURE` | Temperatura LLM | `0.1` |
| `AI_MAX_TOKENS` | Max tokens | `4000` |
| `AI_TIMEOUT_MS` | Timeout LLM | `60000` |
| `AI_MAX_RETRIES` | Reintentos por modelo (429/5xx) | `2` |
| `CRAWLEE_HEADLESS` | Browser headless | `true` |
| `CRAWLEE_MAX_CONCURRENCY` | Concurrencia Crawlee | `5` |
| `CRAWLEE_MAX_REQUESTS_PER_MINUTE` | Rate limit Crawlee | - |
| `WORKER_CONCURRENCY` | Jobs paralelos por worker | `2` |
| `PAGE_CACHE_TTL_MS` | TTL cache páginas | `300000` |
| `PAGE_CACHE_MAX_ENTRIES` | Max entradas cache | `100` |
| `API_KEYS` | Claves API (coma-sep) | - (sin auth) |
| `FIRST_RUN_TOKEN` | Token exigido por `/auth/register-first` en producción (header `X-First-Run`) | - |
| `TRUST_PROXY` | Saltos de proxy de confianza (para que el rate-limit use la IP real) | - (desactivado) |
| `CORS_ORIGINS` | Orígenes CORS permitidos (coma-sep) | - (dev abierto; prod mismo-origen) |
| `RADIOGRAPHY_CONCURRENCY` | Radiografías simultáneas por instancia de API | `2` |
| `RADIOGRAPHY_TIMEOUT_MS` | Timeout de una radiografía de sesión | `120000` |
| `ALLOWED_DOMAINS` | Dominios permitidos | - (todos) |
| `RATE_LIMIT_CREATE_PER_MIN` | Rate limit POST /jobs | `30` |
| `INSTANCE_ID` | ID réplica métricas | `hostname-pid` |

## Estructura del Proyecto

```
apps/
  api/           # NestJS API REST (POST/GET /jobs, /radiography, /metrics, /dashboard)
  worker/        # Procesador de jobs (AgentRunner + browser-engine + planner)
libs/
  shared/core/           # Utilidades puras (hashHtml)
  shared/security/       # SSRF centralizado (assertPublicUrl, isBlockedHost, createAllowlist)
  shared/observability/  # Logger JSON + MetricsCollector (Prometheus, instance labels)
  domain/execution/      # JobStatus/JobLimits/DEFAULT_LIMITS/normalizeJobLimits
  domain/scraper/        # TracedValue/StructuredItem (trazabilidad)
  domain/ai/             # DSL Zod (15 comandos) + CommandValidator + normalize
  application/ai/        # AIOrchestrator + prompts + context-builder
  infrastructure/crawler/       # CrawlerService (CheerioCrawler + PlaywrightCrawler, hybrid, SessionPool)
  infrastructure/execution/     # ExecutionEngine (HTTP/Cheerio + browserInteract) + PageCache
  infrastructure/ai-providers/  # OpenRouterProvider (fallback modelos), CustomEndpointProvider, FallbackAIProvider
  infrastructure/mongodb/       # SiteProfile, PageRadiography, MongoRepository, performRadiography/getLearnedProfile
  infrastructure/redis/         # RedisPageCache, RedisRateLimiter, RedisMetricsAggregator (fallback memoria)
  infrastructure/queue/         # JobQueue (BullMQJobQueue + InMemoryJobQueue) + factory
  infrastructure/storage/       # JobStore (Prisma + InMemory)
prisma/
  schema.prisma  # 8 tablas: User, Job, ScrapingPlan, Command, Page, Result, JobError, AIInteraction
docker-compose.yml # postgres + mongodb + redis + migrate + api + worker
apps/api/Dockerfile      # node:22-alpine + HEALTHCHECK
apps/worker/Dockerfile   # node:22-bookworm-slim + Playwright Chromium
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
GET    /api/v1/radiography/page/*url                # Radiografía cacheada (comodín Express 5)
GET    /api/v1/radiography/domain/:domain/stats      # Stats agregadas
```

### Sesiones tipo "chat" (una URL = un chat)

Backend listo para consumir desde cualquier cliente web (sin frontend incluido).
Flujo recomendado del cliente: **crear → poll status hasta READY → enviar mensajes → poll del job**.

```
POST   /api/v1/sessions                # {url, credentials?: {headers: {Authorization|Cookie|...}}}
                                       # → {id, url, domain, status:"RADIOGRAPHY", ...} y lanza la radiografía
GET    /api/v1/sessions                # Historial: [{id, url, domain, status, error, createdAt, updatedAt}]
GET    /api/v1/sessions/:id            # Detalle: {..., messages:[{role,content,jobId,jobStatus,results}], profile}
GET    /api/v1/sessions/:id/status     # {id, status:"RADIOGRAPHY|READY|FAILED", error}
POST   /api/v1/sessions/:id/messages   # {instruction} → {message, jobId, jobStatus}  (solo si status=READY)
```

Reglas para el cliente:
- Tras crear la sesión, el **input debe bloquearse** hasta que `status === "READY"` (poll cada ~2-3s a `/sessions/:id/status`).
- Si `status === "FAILED"`, mostrar `error` (p.ej. radiografía no completada por timeout).
- Al enviar un mensaje, se crea un **job** con el contexto/perfil de la URL; el cliente hace polling de
  `GET /api/v1/jobs/:jobId` y `GET /api/v1/jobs/:jobId/results` para renderizar la respuesta.
- `GET /sessions/:id` ya incluye `messages[].jobStatus` y `messages[].results` (historial autocontenido).
- `credentials.headers` se **cifran** (AES-256-GCM, `CREDENTIALS_KEY`) y se aplican a HTTP y browser; nunca se devuelven.
- Todas las rutas requieren `x-api-key` (ver Autenticación).

### Métricas / Observabilidad
```
GET    /api/v1/metrics                 # JSON (stats DB + process + aiRecoveryRate)
GET    /api/v1/metrics/prometheus      # Prometheus text exposition (labels `instance` + `scraper_distributed_*`)
GET    /api/v1/health                  # Liveness
GET    /api/v1/health/ready            # Readiness (store + cola; 503 si fallan)
GET    /api/v1/dashboard               # SPA dashboard (auto-refresh 5s)
```

## Autenticación y Rate Limiting

- **API Key**: SOLO header `x-api-key` (config `API_KEYS` en `.env`, coma-separadas).
  - Sin claves: abierto en dev/test; **en `NODE_ENV=production` se cierra (401)** por defecto.
  - La clave por query string ya no se acepta (evita fugas en logs/Referer).
  - También acepta claves de **usuarios registrados en BD** (hash SHA-256); la API key que
    devuelve `/auth/register-first` autentica directamente.
  - Protegidos: `/jobs`, `/radiography` y `/metrics`. El dashboard SPA pide la clave y la envía por header.
  - Prometheus debe enviar `x-api-key` al scrapear `/metrics/prometheus` si `API_KEYS` está activo.
- **Bootstrap (`POST /api/v1/auth/register-first`)**: crea el primer superadmin **solo si no hay usuarios**
  (si ya hay, 409; no hay `force`). En producción exige el header `X-First-Run` = `FIRST_RUN_TOKEN`
  (fail-closed: sin token configurado, 403). Devuelve la API key **una sola vez** (se guarda hasheada).
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
   -> FASE 4: generatePlan() -> inyecta learnedProfile al LLM -> normaliza (normalizeRawPlan) -> plan validado
   -> FASE 5: Fase A (plan) + Fase B (Observe→Think→Act loop, comandos normalizados)
   -> FASE 3: CLICK/SCROLL -> CrawlerService.interact() (Chromium real)
   -> FASE 6: Recovery automático (max 2 intentos)
   -> FASE 11: PageCache (Redis) + dedupe URLs + prioridades
   -> LLM: fallback automático de modelos ante 404/429 (OpenRouter)

3. Persistencia (PostgreSQL via Prisma)
   -> Job, ScrapingPlan, Command, Page, Result, JobError, AIInteraction
   -> FASE 12: recordJobResult() -> actualiza SiteProfile stats

4. Resultados
   -> GET /jobs/:id/results -> items con _source{url,selector,scrapedAt,confidence}
   -> GET /jobs/:id/ai -> llamadas LLM con tokens/latencia
```

## Métricas y Observabilidad

- **Logs**: JSON estructurado (`{ts,level,msg,instance,jobId,provider,...}`) — Loki/ELK ready
- **Métricas proceso**: `MetricsCollector` (counters/gauges) + `GET /metrics` + `GET /metrics/prometheus`
- **Métricas distribuidas (Redis)**: el worker publica contadores al `RedisMetricsAggregator`; `GET /metrics`
  expone `distributed` y Prometheus añade `scraper_distributed_*` (suma global entre réplicas/workers).
  Cada réplica expone además su `scraper_*{instance=...}` local → `sum by (instance)` en Grafana.
- **Health**: `GET /health` (liveness) y `GET /health/ready` (readiness: comprueba store + cola; 503 si fallan)
- **Dashboards**: `GET /dashboard` (SPA auto-refresh, pide API key) + Grafana

## Seguridad

- **SSRF centralizado** (`@ai-scraper/shared-security`): `assertPublicUrl`, `assertSafeUrl` (resuelve DNS),
  `isBlockedHost`/`isBlockedIp` (IPv4/IPv6: loopback, privadas, link-local, ULA, CGNAT, IPv4-mapped),
  `safeFetchText` (revalida **cada redirect** y el tamaño del body), `createAllowlist`.
  `ALLOW_PRIVATE_HOSTS=1` solo tiene efecto fuera de `NODE_ENV=production`.
- **Allowlist por job**: dominio fijado al crear job, IA no puede escalar.
- **Límites anti-escalada (§35)**: `PAGINATE/FOLLOW_LINKS/EXTRACT_LIST` se recortan en planner **y** en
  cada decisión dinámica (Fase B/recovery); `maxRuntimeSec` actúa como deadline del job.
- **Auth fail-closed**: `API_KEYS` por header `x-api-key`; en `NODE_ENV=production` sin claves, todo responde 401.
- **DSL tipado**: 15 comandos Zod — la IA **nunca** ejecuta código arbitrario.
- **Rate limits**: API (Redis sliding-window, fallback memoria) + Crawlee (`CRAWLEE_MAX_REQUESTS_PER_MINUTE`).
- **Sanitización**: HTML >2MB rechazado, timeout 20s, UA propio.
- **Idempotencia**: reintentos BullMQ limpian artefactos previos (`clearJobArtifacts`); cancelación
  interrumpible entre pasos; apagado graceful (SIGTERM/SIGINT) cierra Prisma/Mongo/Redis/BullMQ.

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

## Integración con OpenRouter (IA)

El sistema usa **OpenRouter** como proveedor LLM por defecto (OpenAI-compatible). La IA decide QUÉ hacer
(plan + decisiones), el motor decide CÓMO ejecutarlo. Para que funcione con modelos económicos/free,
hay tres capas de robustez:

### 1. Selección de modelo y fallback automático

`libs/infrastructure/ai-providers/src/openrouter/openrouter.provider.ts` prueba en orden:
`OPENROUTER_MODEL` → cada uno de `OPENROUTER_FALLBACK_MODELS`. Salta al siguiente modelo **solo** en:
- `404` — el modelo no existe / no disponible para tu cuenta
- `429` — rate limit del proveedor

Cualquier otro error (401, 402, 403, 5xx…) se propaga y no se reintenta con otro modelo.

```bash
# Opción recomendada para tests/dev: router que auto-elige un free disponible
OPENROUTER_MODEL=openrouter/free
# O un modelo concreto gratuito (sufijo :free)
OPENROUTER_MODEL=qwen/qwen3.8-27b:free
OPENROUTER_FALLBACK_MODELS=qwen/qwen3.8-27b:free,nvidia/nemotron-3-super-120b-a12b:free,google/gemma-4-26b-a4b-it:free
```

> ⚠️ **Los modelos `:free` cambian con el tiempo** (los IDs rotan y se deprecan). Consúltalos en
> `https://openrouter.ai/models?q=free` o vía API: `curl https://openrouter.ai/api/v1/models`.
> Precio $0 = prompt pricing `"0"`. Los free tienen **rate limit** (≈20-50 req/min).

### 2. Prompts reforzados con el esquema DSL

Los prompts del planner/explorer/recovery incluyen el **esquema DSL completo** (15 comandos) y un
ejemplo, exigiendo el campo `"type"` en MAYÚSCULAS y prohibiendo comandos inventados
(`loop`, `waitForSelector`, etc.). Ver `libs/infrastructure/ai-providers/src/prompts.ts`.

### 3. Normalizador de comandos (anti-alucinación)

Los modelos débiles suelen desviarse. `libs/domain/ai/src/normalize.ts` **corrige antes de validar**:

| El modelo devuelve | Se normaliza a |
|---|---|
| `{"action":"navigate","url":...}` | `{"type":"NAVIGATE","url":...}` |
| `{"action":"extractList",...}` | `{"type":"EXTRACT_LIST",...}` |
| `{"type":"loop",...}` (inventado) | se **descarta** |
| `EXTRACT_LIST` sin `fields` | `fields` por defecto (name/price/link/image) |
| `maxItems` / `cssSelector` / `pages` | `limit` / `selector` / `maxPages` |
| `{steps:[...]}` o `{plan:[...]}` | `actions` |

Aun así, la **validación estricta** (§26/§37) sigue: un comando que viola dominio/SSRF/límites hace
fallar el plan. Los comandos inventados se filtran; los maliciosos se rechazan.

### Verificar tu clave / modelos

```bash
# ¿Qué modelos free tiene mi cuenta?
curl https://openrouter.ai/api/v1/models -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  | python3 -c "import sys,json; [print(m['id']) for m in json.load(sys.stdin)['data'] if ':free' in m['id']]"

# Probar una llamada simple
curl https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"openrouter/free","messages":[{"role":"user","content":"say ok"}],"max_tokens":10}'
```

### Alternativa sin coste: endpoint local (Ollama)

```bash
ollama pull llama3.1:8b && ollama serve
# .env:
AI_PROVIDER=custom
AI_CUSTOM_ENDPOINT=http://localhost:11434/v1
AI_CUSTOM_MODEL=llama3.1:8b
```

## Troubleshooting


| Problema | Solución |
|---|---|
| `MongooseServerSelectionError` | Levantar MongoDB: `docker compose up -d mongodb` |
| `ECONNREFUSED redis` | Levantar Redis: `docker compose up -d redis` |
| Jobs se quedan QUEUED | Verificar worker corriendo + `REDIS_URL` correcto |
| `playwright: executable doesn't exist` | `npx playwright install --with-deps chromium` (en worker Dockerfile ya está; para E2E local fuera de Docker, ejecutar en host) |
| Tests fallan por flakiness | `npm test` usa `--test-concurrency=1` |
| `npm test` falla solo el umbral de cobertura de funciones | La cobertura de funciones difiere por plataforma: en Windows puede salir por debajo del 67% aunque los tests pasen. El gate verde es CI (Linux, Node 22) |
| `openapi:check` falla en Windows | El script compara el fichero byte a byte y el checkout local usa CRLF; el fichero versionado es LF y CI (Linux) pasa |
| Radiografía lenta | Forzar `forceBrowser: true` si sitio es JS-heavy |
| OpenRouter `404 No endpoints found` | Modelo inexistente/deprecado → usa `openrouter/free` o IDs `:free` actuales; revisa `OPENROUTER_FALLBACK_MODELS` |
| OpenRouter `403 Key limit exceeded` | Sin créditos o límite total de la clave → recarga en openrouter.ai o usa Ollama local |
| OpenRouter `429` | Rate limit del modelo free → el fallback salta al siguiente modelo automáticamente |
| Plan inválido del LLM | El normalizador lo corrige; si persiste, usa un modelo mayor (paid) o sube `AI_MAX_TOKENS` |

## Contribuir

```bash
git checkout -b feature/x
# Cambios + tests
npm run lint && npm test && npm run build
git push && PR
```

---

**Licencia**: MIT — Úsalo, modifícalo, rómpelo, arréglalo.
