# api

La **interfaz HTTP** del sistema: una API NestJS que expone `/api/v1` y **solo encola**
trabajo; nunca ejecuta un job (`R-AR-3`). Su objetivo hexagonal es ser un adaptador de
entrada delgado y composition root (`R-HX-10`).

- **Dependencias exclusivas**: NestJS 12 (`@nestjs/common`, `core`, `platform-express`,
  `swagger`), `class-validator`/`class-transformer`, los puertos de
  `application-execution` y las libs de dominio, shared e infraestructura declaradas
  en `package.json`.
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

> **Deuda F8–F9 (ADR-33):** los servicios HTTP de jobs, sesiones, usuarios y
> radiografía ya son adaptadores delgados de casos de uso en `application-execution`;
> el wiring de adaptadores vive en `providers.ts`/módulos. Falta el workflow del
> agente en `apps/worker` (F8.3) y la composición/observabilidad de borde (F9).
