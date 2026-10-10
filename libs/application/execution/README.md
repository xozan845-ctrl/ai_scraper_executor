# @ai-scraper/application-execution

Contratos de aplicación para ejecutar jobs sin acoplar los casos de uso a Prisma,
BullMQ ni implementaciones en memoria. Es el consumidor y propietario de los puertos
de persistencia y cola (`R-HX-11`).

- **Capa**: aplicación.
- **Dependencias**: `@ai-scraper/domain-execution` para estados y límites del job.
- **Superficie pública**:
  - `JobStore`, `SessionStore`, `JobQueue` — puertos implementados por infraestructura.
  - DTOs de jobs, resultados, sesiones y mensajes de cola.
  - `normalizePriority` — normalización pura de prioridad a `1..10`.

No exporta adaptadores ni conoce Prisma, Redis o BullMQ.

## Comandos

```bash
npm run build -w @ai-scraper/application-execution
MONGODB_MOCK=1 npm test
```
