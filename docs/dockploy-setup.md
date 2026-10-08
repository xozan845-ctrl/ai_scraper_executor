# Despliegue — guion operativo

> Documento **operativo** (no normativo): la normativa viva está en
> [`rules/cd/`](./rules/cd/README.md) (`R-CD-*`) y el modelo de ramas en
> [`rules/git/00-entornos.md`](./rules/git/00-entornos.md) (`R-GE-*`). Este guion
> es la **lista de tareas** para dejar un entorno acorde a esa normativa.
>
> **Sobre el nombre del fichero:** se llama `dockploy-setup.md` por herencia del
> proyecto del que se copió este árbol de documentación, que desplegaba con Dockploy.
> Aquí el despliegue es **`docker compose`** sobre el host o un VPS cualquiera; no
> hay Dockploy, ni panel de entornos, ni `staging`/`produccion`. El nombre se
> conserva para no romper enlaces externos, pero el contenido es el real.

## 0. Objetivo y realidad

Un solo entorno desplegable. La rama es `main`; la promoción entre entornos
**no está implementada** y figura como deuda en `R-GE-5`.

| Entorno | Dónde corre | Cómo llega | Riesgo |
|---|---|---|---|
| Desarrollo | **local** | `docker compose up -d --build`, o solo las BDs para tests | nulo |
| Despliegue | host/VPS con Compose | `docker compose up -d --build` desde un commit de `main` verificado | **alto: consume tokens de LLM y peticiones a terceros** |

**Regla de oro:** lo desplegado viene de un commit de `main` con el workflow
`ci` en verde —ambos jobs, `build-test-lint` e `integration`— (`R-GE-4`, `R-CI-1`,
`R-PR-8`). No hay build automático
por webhook: quien despliega comprueba antes que el run del commit está verde, y
comprueba el smoke después (`R-CD-12`).

## 1. Requisitos

- Docker Engine + Compose v2 en el host destino.
- El repositorio en el commit que se va a desplegar.
- Chromium en la imagen del worker: lo instala su propio `Dockerfile`
  (`npx playwright install --with-deps chromium`), no hay que hacer nada en el host.
- Memoria suficiente para dos contenedores Node **más** Chromium. El worker es el
  que consume; dimensionarlo por `CRAWLEE_MAX_CONCURRENCY` (5 por defecto).
- Una clave de LLM válida, o el sistema no podrá hacer su trabajo principal.

## 2. Variables de entorno

El punto de partida es [`.env.example`](../.env.example), que **no contiene secretos**
(los de OpenRouter vienen como `sk-sustituir` y las listas de `API_KEYS` /
`CREDENTIALS_KEY` van vacías). `.env` está en `.gitignore` **y** en
`.dockerignore`, así que nunca se versiona ni entra en la imagen (`R-SE-17`).

| Variable | Por qué importa | Qué pasa si falta |
|---|---|---|
| `OPENROUTER_API_KEY` | El LLM planifica el scraping | El job termina en error; sin IA no hay producto |
| `OPENROUTER_MODEL`, `OPENROUTER_FALLBACK_MODELS` | Modelo y cadena de repliegue | Usa el valor por defecto del código |
| `API_KEYS` | Autenticación de la API | En `NODE_ENV=production` **todas** las rutas protegidas devuelven `401` y el arranque escribe un `error` explícito (`R-SE-9`) |
| `CREDENTIALS_KEY` | Cifra las credenciales de sesión (AES-256-GCM) | Las sesiones **con** credenciales se rechazan; las que no, funcionan (`R-SE-12`) |
| `DATABASE_URL`, `MONGODB_URI`, `REDIS_URL` | Los tres almacenes | El `compose` los sobreescribe con las URLs internas de servicio; si faltan, Mongo y Redis degradan a memoria **avisando** (`R-MO-5`, `R-RD-5`) |
| `CORS_ORIGINS` | Orígenes permitidos del dashboard | En producción **no** se emite ninguna cabecera CORS (mismo origen) (`R-SE-14`) |
| `TRUST_PROXY` | Nº de saltos de confianza, si hay LB/proxy delante | El rate limit ve la IP del proxy, no la del cliente (`R-SE-15`) |
| `ALLOWED_DOMAINS` | Allowlist de dominios por job | Vacío = cualquier host **público**; el SSRF sigue activo en cualquier caso (`R-SE-1..8`) |
| `WORKER_CONCURRENCY` | Jobs simultáneos por worker | 2 |
| `CRAWLEE_MAX_CONCURRENCY` | Navegadores simultáneos por worker | 5 |

**Copia por entorno:** si algún día hay dos entornos, `CREDENTIALS_KEY` **no** se
reutiliza entre ellos ( compromising una no compromete la otra), igual que
`API_KEYS` y `OPENROUTER_API_KEY`.

## 3. Levantar

```bash
# 1. Solo la infraestructura (suficiente para tests con BD real y para el E2E)
docker compose up -d postgres mongodb redis

# 2. Todo: el servicio `migrate` corre `prisma migrate deploy` y bloquea el
#    arranque de api y worker (condition: service_completed_successfully)
docker compose up -d --build

# 3. Estado
docker compose ps
docker compose logs -f api worker
```

Lo que **no** se hace, y por qué (`R-CD-9`/`R-CD-10`):

- ❌ Arrancar `api` o `worker` sin `migrate`: un proceso sin esquema falla en la
  primera consulta, de forma confusa. Si se necesita arrancar solo la API para
  depurar, es un entorno local, no un despliegue.
- ❌ `prisma migrate dev` contra el entorno: genera migraciones no versionadas y
  puede pedir resetear la base de datos.
- ❌ `docker compose down -v`: borra los volúmenes (`postgres-data`,
  `mongodb-data`, `redis-data`) y con ellos los datos. Es la única operación de este
  guion que pierde información, y no se ejecuta sin confirmación explícita.
- ❌ Escalar sin pensar: `--scale worker=3` funciona (rate limit y caché son
  compartidos por Redis, el trabajo se reparte por BullMQ), pero multiplica la
  presión sobre el sitio objetivo. `WORKER_CONCURRENCY` y
  `CRAWLEE_MAX_CONCURRENCY` no se revisan al subir réplicas.

## 4. Smoke tras el despliegue

Sin esto el despliegue no está hecho (`R-CD-12`):

```bash
# Liveness: el proceso vive
curl -fsS http://localhost:3000/api/v1/health

# Readiness: store y cola responden. 503 con el detalle si algo no va
curl -fsS http://localhost:3000/api/v1/health/ready

# La API responde (con cabecera de autenticación en producción)
curl -fsS -H "x-api-key: $API_KEYS" http://localhost:3000/api/v1/metrics

# El cliente real de la API: los flujos completos (sesiones, jobs, radiografía)
npm run test:api:fast
```

Un smoke rojo **no se deja corriendo**: se corrige con un commit nuevo (`R-GE-6`) o
se revierte al commit anterior y se reconstruye (`R-CD-12`). Nunca se revierten
migraciones aplicadas (`R-CD-5`).

## 5. Primer arranque: el primer usuario

Con `NODE_ENV=production`, la API arranca **cerrada** si no hay `API_KEYS`. El
bootstrap del primer usuario (`POST /api/v1/auth/register-first`) exige el header
`X-First-Run` con `FIRST_RUN_TOKEN`. Procedimiento:

1. Desplegar con `API_KEYS` y `FIRST_RUN_TOKEN` ya definidos.
2. Registrar el primer usuario (superadmin) con ese token.
3. Guardar la API key que devuelve: es una credencial de la base de datos y
   autentica igual que las de `API_KEYS` (`R-SE-10`).
4. A partir de ahí, `FIRST_RUN_TOKEN` puede vaciarse en el entorno.

Detalle del flujo en [`README.md`](../README.md) y en el cliente real
(`npm run test:api`).

## 6. Observabilidad del despliegue

- **Logs**: JSON estructurado por proceso, con `correlationId` que viaja de la API al
  worker vía contexto (`runWithContext`/`updateContext`, `R-OB-*`). Para seguir un
  job: `docker compose logs worker | grep <correlationId>`.
- **Métricas**: `/api/v1/metrics` y `/api/v1/metrics/prometheus` exponen lo agregado. El worker
  publica en Redis y la API agrega (`scraper_distributed_*`), de modo que las
  métricas de varios workers aparecen juntas (`R-TM-*`).
- **Stack local de observabilidad**: `docker-compose.observability.yml` levanta
  Prometheus + Grafana sobre el compose base (`infra/observability/`, ADR-24) con las
  métricas reales del proyecto. Es para inspección local; el **envío de alertas**
  (Alertmanager) sigue sin provisionar (`R-TM-5`/`R-TM-9`).
- **Sin recogida centralizada de logs**: el despliegue no monta un agregador. Quien
  necesite retention, lo añade; hoy los logs se pierden con el contenedor.

## 7. Revertir

```bash
# Volver al commit anterior y reconstruir
git checkout <commit-anterior>
docker compose up -d --build
```

La unidad de reversión es el **commit**, no el digest de imagen: hoy el `compose`
construye desde fuente, así que la imagen no es inmutable (`R-CD-3`). Y las
migraciones **no** se revierten: se vuelve al código anterior, que es compatible con
el esquema ya aplicado (`R-CD-5`).

## 8. Lo que este guion todavía no cubre

| Falta | Por qué | Dónde está registrado |
|---|---|---|
| Entornos separados (stage/producción) | No están implementados; hay una rama | `R-GE-5`, ADR-15 en [`decisiones.md`](./decisiones.md) |
| Despliegue por digest desde GHCR | `release.yml` ya publica imágenes (ADR-22), pero el `compose` sigue construyendo desde fuente | `R-CD-3` |
| Aprobación de producción como puerta | Hoy la puerta es el merge verificado a `main` | `R-CD-6` |
| Despliegue automático desde CI | Hoy es una orden manual | `R-CI-4` |
| Envío de alertas (Alertmanager) | Prometheus/Grafana locales ya provisionados (ADR-24), sin gestor de notificaciones | `R-TM-5`/`R-TM-9` |

Ninguna de esas ausencias es un olvido: están normadas como deuda en
[`rules/cd/`](./rules/cd/README.md) y en
[`rules/_meta/AUDIT.md`](./rules/_meta/AUDIT.md).
