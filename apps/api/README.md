# api

La **interfaz** del sistema: una API NestJS que expone `/api/v1` y **solo encola**
trabajo; nunca ejecuta un job (`R-AR-3`). Es la capa `INTERFACE` (`R-AR-2`).

- **Dependencias exclusivas**: NestJS 12 (`@nestjs/common`, `core`, `platform-express`,
  `swagger`), `class-validator`/`class-transformer` y los packages `core`, `storage`,
  `queue`, `redis`, `mongodb`, `observability` y `security`.
- **Superficie (endpoints bajo `/api/v1`)** — `R-C-1`:
  - `POST /jobs`, `GET /jobs`, `GET /jobs/:id`, `/jobs/:id/results|execution|ai`,
    `POST /jobs/:id/cancel|retry` — ciclo de un job, con `Idempotency-Key` (`R-DI-2`) y
    paginación por cursor (`R-DB-5`).
  - `POST /auth/register-first` — bootstrap del primer usuario.
  - `POST /sessions`, `GET /sessions/:id` (`/status`, `/messages`) — flujo de chat con
    radiografía asíncrona.
  - `POST /radiography`, `GET /radiography/profile/:domain`, `/domain/:domain/stats`.
  - `GET /health`, `/health/ready` (liveness/readiness), `/metrics`, `/metrics/prometheus`,
    `/dashboard`, `/docs` (Swagger).
- **Defensas**: `ApiKeyGuard` fail-closed (`R-SE-9`/`R-SE-10`), `ValidationPipe` global
  con `whitelist` (`R-DS-4`), rate limit en los puntos que crean coste (`R-SE-15`).

## Comandos

```bash
npm run build -w api
npm run dev:api        # ts-node --transpile-only, recarga en desarrollo
npm run start -w api   # node dist/main.js
curl -fsS http://localhost:3000/api/v1/health
```

> Requiere Postgres/Redis/Mongo (o sus fallbacks en memoria). Ver [`AGENTS.md`](../../AGENTS.md)
> y [`docs/rules/architecture/`](../../docs/rules/architecture/README.md).
