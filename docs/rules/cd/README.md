# Reglas de CD — AI Web Scraping Executor

Cómo se entrega lo que `main` decide: imágenes, orden de arranque, migraciones,
composición y reversión. La mecánica es **Docker + Compose**, no un panel de
despliegue con entornos.

> ## La realidad del repo
>
> | | Estado verificado |
> |---|---|
> | Imágenes | **Dos Dockerfiles**: `apps/api/Dockerfile` (node:22-alpine) y `apps/worker/Dockerfile` (node:22-bookworm-slim + Chromium) |
> | Composición | **Un `docker-compose.yml`** en la raíz con 6 servicios: `postgres`, `mongodb`, `redis`, `migrate` (one-shot), `api`, `worker` |
> | Migraciones | Servicio `migrate` que corre `npx prisma migrate deploy` y **bloquea** el arranque de `api` y `worker` (`condition: service_completed_successfully`) |
> | Release por tag | **Existe** ([`release.yml`](../../../.github/workflows/release.yml)): tag `v*.*.*` o dispatch con `dry_run`; imágenes en GHCR con etiquetas OCI (`R-CD-1..8`) |
> | Entornos | **No hay**: ni `staging` ni `produccion`; una sola rama (`R-GE-1`) y un solo conjunto de secretos |
> | Health | `HEALTHCHECK` en la imagen de la API contra `/api/v1/health` |
>
> Es decir: el despliegue **es real y reproducible** (compose), pero **la release
> automática y la promoción entre entornos no existen**. `R-CD-1..8` son el
> contrato exigible el día que exista un pipeline de release; `R-CD-9..12` norma
> la entrega que sí hay. Los **puertos publicados en el host** son configurables
> (`API_PORT`, `POSTGRES_PORT`, `MONGODB_PORT`, `REDIS_PORT`) — ver
> [`02-entornos.md`](./02-entornos.md).

## Archivos

| Archivo | Contenido | IDs |
|---|---|---|
| `01-despliegue.md` | Release por tag, procedencia, imágenes por digest, migraciones, secretos, dry-run | `R-CD` (1–8) |
| `02-entornos.md` | Orden de arranque con Compose, servicios, escalado del worker, smoke, rollback, secretos por entorno | `R-CD` (9–12) |

## Mapa de IDs

| Prefijo | Rango | Archivo | Ámbito |
|---|---|---|---|
| `R-CD-*` | 1–8 | `01-despliegue.md` | Artefactos de release (tag, digest, OCI, migraciones, secretos) |
| `R-CD-*` | 9–12 | `02-entornos.md` | Entrega real con Compose: arranque, escalado, smoke, rollback |

## Cómo se entrega hoy (recorrido real)

```bash
# 1. Solo la infraestructura (lo que necesita el E2E y el desarrollo)
docker compose up -d postgres mongodb redis

# 2. Todo: migraciones + api + worker
docker compose up -d --build

# 3. Comprobación
curl -fsS http://localhost:3000/api/v1/health
curl -fsS http://localhost:3000/api/v1/health/ready
```

El orden lo impone el propio `compose`: `api` y `worker` arrancan **después** de que
`migrate` termine con éxito, y cada base de datos tiene su `healthcheck`, así que un
puerto que no responde no se propaga como fallo de aplicación.

## Pendientes (deuda)

- **Release por tag (ya existe)**: [`release.yml`](../../../.github/workflows/release.yml)
  se dispara con el push de un tag `v*.*.*` (o a mano con `dry_run` por defecto).
  Valida el tag y la procedencia (commit en `main` y run de `ci` verde), y construye
  las dos imágenes en GHCR con etiquetas OCI; la construcción de la entrega actual
  (`docker compose up -d --build`) sigue siendo la vía local. **Proceso vigente**: el
  tag se corta **después** de que el E2E (`G-6`) esté verde. `R-CD-6` (aprobación de
  producción) sigue siendo la puerta del merge verificado a `main`.
- **No hay entornos**: una sola configuración para un solo destino. La promoción
  `staging` → producción del proyecto de origen **no se replica**: aquí se registra
  como deuda en [`../git/00-entornos.md`](../git/00-entornos.md) (`R-GE-5`).
- **Escalado**: el `compose` lo soporta (`docker compose up --scale worker=3`, con el
  rate limit compartido por Redis) pero no hay job ni política que lo aplique.
- **Métricas**: los servicios no declaran `ports` para el agregador de Redis ni
  Prometheus; la observabilidad es interna al proceso.

## Cómo verificar

```bash
# el grafo de arranque real: quién depende de quién
docker compose config --services
docker compose config | grep -A3 "depends_on"

# las imágenes que se construyen
docker compose build api worker

# smoke de la entrega (R-CD-11)
curl -fsS http://localhost:3000/api/v1/health
curl -fsS http://localhost:3000/api/v1/health/ready

# que las migraciones son solo hacia adelante (R-CD-5)
ls prisma/migrations
npx prisma migrate status --schema=prisma/schema.prisma
```
