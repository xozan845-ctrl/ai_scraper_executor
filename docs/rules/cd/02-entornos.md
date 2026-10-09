# 02 — Entrega con Compose: arranque, escalado, smoke y rollback (`R-CD-9..12`)

Reglas de la entrega **que sí existe**: un `docker-compose.yml` en la raíz con
`postgres`, `mongodb`, `redis`, `migrate` (one-shot), `api` y `worker`, y un
`Dockerfile` por app. Consumen el modelo de ramas de
[`../git/00-entornos.md`](../git/00-entornos.md) (`R-GE-*`): aquí se despliega lo que
`main` decide.

> **Promoción por imágenes inmutables.** El compose sigue siendo un único conjunto de
> servicios; la promoción a `staging`/`production` es de **imágenes** (etiqueta de entorno
> sobre el mismo digest de GHCR) y la gobierna
> [`promote.yml`](../../../.github/workflows/promote.yml) (ADR-32, `R-GE-5`), no un compose
> por entorno. Estas reglas norman la entrega; los entornos los configura el operador.

## Reglas

| ID | Regla |
|---|---|
| R-CD-9 | **El arranque lo impone el grafo, no el operador**: los tres almacenes de datos tienen `healthcheck` (`pg_isready`, `mongosh … ping`, `redis-cli ping`) y `api`/`worker` arrancan solo cuando las dependencias están `healthy` **y** el servicio `migrate` ha terminado con `service_completed_successfully`. Consecuencia obligatoria: nunca se arranca `api` o `worker` saltándose `migrate` (ni con `--no-deps`, ni subiendo solo esos servicios sin el one-shot), porque un proceso que arranca sin esquema falla de forma confusa en la primera consulta en lugar de negarse a arrancar. Un despliegue manual de la API sin la base de datos no es un despliegue. |
| R-CD-10 | **El servicio `migrate` es one-shot y corre `migrate deploy`, nunca `migrate dev`**: el `compose` lo declara así y con un comentario que lo dice. `migrate dev` en un despliegue genera migraciones no versionadas, puede pedir resetear la base de datos y es la vía por la que un entorno llega a un esquema que nadie ha revisado (R-CD-5, R-DB-3). Los tres almacenes usan además **volúmenes nombrados** (`postgres-data`, `mongodb-data`, `redis-data`), así que la persistencia sobrevive a un `down` sin `-v`. Un `docker compose down -v` sobre un entorno con datos es una pérdida de datos annoncée por un flag, no un accidente: nunca se ejecuta sin confirmación explícita. |
| R-CD-11 | **Los secretos se inyectan en ejecución y son distintos por entorno**: el `compose` carga `.env` con `env_file` y sobreescribe solo las tres URLs internas (`DATABASE_URL`, `MONGODB_URI`, `REDIS_URL`) para que apunten a los nombres de servicio de la red. Ese sobreescrito es deliberado: sin él, la aplicación hablaría con `localhost` desde dentro del contenedor y fallaría de forma engañosa. Lo que **nunca** se hace es escribir una credencial dentro del `compose` (el `POSTGRES_*` usa `${VAR:-valor de desarrollo}`, que es un default de desarrollo, no un secreto) ni en un `Dockerfile` (R-CD-7). En un despliegue real, `API_KEYS`, `CREDENTIALS_KEY`, `OPENROUTER_API_KEY` y `CORS_ORIGINS` vienen del entorno del host, `.env` está en `.gitignore` **y** en `.dockerignore`, y `CREDENTIALS_KEY` no se reutiliza entre entornos (R-SE-12, R-SE-17). |
| R-CD-12 | **Smoke tras cada entrega y reversión por commit**: tras cada `up`/`build` se comprueba `GET /api/v1/health` (liveness) y `GET /api/v1/health/ready` (readiness, que verifica store y cola y devuelve `503` con el detalle si algo no responde); un despliegue sin smoke en verde no se da por bueno, y el resultado se anota junto al cambio (R-GE-3). Una entrega mala se revierte **volviendo al commit anterior** y reconstruyendo — la imagen no es inmutable hoy (R-CD-3), así que la unidad de reversión es el commit, no el digest — y **nunca** revirtiendo migraciones aplicadas (R-CD-5). Un smoke rojo en un despliegue ya hecho no se "deja corriendo": o se corrige con un commit nuevo (R-GE-6) o se revierte. El comando de referencia para el smoke completo es `npm run test:api:fast` contra el entorno. |

## Sobre los puertos publicados

El `compose` publica puertos en el **host** para la API (`3000`) y para los tres
almacenes (`5432`, `27017`, `6379`). En un host compartido (p. ej. Dokploy) ese mapeo
fijo choca con otro servicio: el arranque falla con
`Bind for 0.0.0.0:3000 failed: port is already allocated`. Por eso todos son
**configurables por entorno** con default local:

| Variable | Host por defecto | Contenedor (fijo) |
|---|---|---|
| `API_PORT` | `3000` | `3000` |
| `POSTGRES_PORT` | `5432` | `5432` |
| `MONGODB_PORT` | `27017` | `27017` |
| `REDIS_PORT` | `6379` | `6379` |

**Regla de despliegue**: en un host con más de un compose, fija cada `*_PORT` a un
puerto libre (o deja que tu proxy enrute a `api:3000` sin publicar `API_PORT`). El
lado del contenedor no cambia: las URLs internas (`DATABASE_URL`, `MONGODB_URI`,
`REDIS_URL`) siguen apuntando a los nombres de servicio, no a estos puertos. Publicar
un puerto que ya está asignado es un fallo de arranque, no una degradación aceptable.

## Sobre el escalado del worker

El `compose` lo permite explícitamente (`docker compose up --scale worker=3`) y el
sistema lo soporta, pero no hay política que lo aplique. Lo que **sí** está resuelto
para el escalado horizontal:

- El rate limit y la caché de páginas son **compartidos por Redis**, no por proceso
  (`RedisRateLimiter`, `RedisPageCache`), con respaldo en memoria (R-RD-5).
- El trabajo se reparte por **cola BullMQ**, con reintentos y DLQ
  (`SCRAPING_DEAD_QUEUE` = `scraping-jobs-dead`).
- `WORKER_CONCURRENCY` (2 por defecto) limita los jobs por worker y
  `CRAWLEE_MAX_CONCURRENCY` (5) el navegador por worker: subir réplicas sin revisar
  estos dos números multiplica la presión sobre el sitio objetivo, que es un tercero
  (R-SE-15).

Añadir réplicas es una decisión de despliegue, no uniscale gratuito: se declara en el
`compose` o en el comando de despliegue, nunca "porque el job va lento".

## Verificación

```bash
# el grafo de arranque que R-CD-9 exige respetar
docker compose config | grep -B2 -A6 "depends_on"

# el one-shot usa deploy, no dev (R-CD-10)
docker compose config | grep -A3 "command: npx prisma"

# secretos: env_file sí, credencial literal no (R-CD-11)
grep -n "env_file\|PASSWORD\|API_KEY" docker-compose.yml

# smoke de la entrega (R-CD-12)
curl -fsS http://localhost:3000/api/v1/health
curl -fsS http://localhost:3000/api/v1/health/ready

# el healthcheck que la imagen declara
docker inspect --format '{{json .State.Health}}' <contenedor-api>
```
