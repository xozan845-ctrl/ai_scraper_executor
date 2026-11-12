# @ai-scraper/application-execution

Casos de uso de ejecución sin acoplar la lógica a Prisma, BullMQ, Nest ni
implementaciones en memoria. Es el consumidor y propietario de los puertos de
persistencia, cola, métricas y de las integraciones del borde (`R-HX-11`).

- **Capa**: aplicación.
- **Dependencias**: `@ai-scraper/domain-execution` (estados y límites) y
  `@ai-scraper/shared-security` (política SSRF inyectada).
- **Superficie pública**:
  - Puertos: `JobStore`, `SessionStore`, `JobQueue`, `JobMetrics`, `EnginePageCache`,
    `UserRepository`, `SiteKnowledge`, `RadiographyRunner`, `SiteProfileReader`,
    `SessionCredentials` y `SessionJobGateway`.
  - **Jobs**: `createJobUseCases` → `CreateJobUseCase`, `JobQueries`, `CancelJobUseCase`,
    `RetryJobUseCase`; `JobView` sin `ownerScope`; `JobUrlRejectedError`/`JobEnqueueError`.
  - **Sesiones**: `createSessionUseCases` → `CreateSessionUseCase`, `SessionQueries`,
    `SendSessionMessageUseCase`; radiografía en background con concurrencia/timeout
    inyectados y historial enriquecido con estado/resultados del job.
  - **Radiografía**: `createSiteRadiographyUseCases` con errores de perfil/radiografía
    no encontrados.
  - **Usuarios**: `createUserUseCases`, `hashApiKey`, `generateApiKey` y
    `UserAlreadyExistsError`; el registro inicial se cierra tras el primer usuario.
  - DTOs de jobs, resultados, sesiones y mensajes de cola.
  - `normalizePriority` — normalización pura de prioridad a `1..10`.

No exporta adaptadores ni conoce Prisma, Redis, Mongo o BullMQ.

## Comandos

```bash
npm run build -w @ai-scraper/application-execution
MONGODB_MOCK=1 npm test
```
