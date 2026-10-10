# @ai-scraper/infrastructure-queue

Adaptadores de `JobQueue`: BullMQ sobre Redis y respaldo en memoria, incluida la cola
de muertos. La API encola y el worker consume (`R-AR-3`).

- **Capa**: infraestructura.
- **Dependencias exclusivas**: `bullmq`, `ioredis` y
  `@ai-scraper/application-execution`, que es propietario del puerto (`R-HX-11`).
- **Superficie pública**:
  - `createJobQueue` / `BullMQJobQueue` / `InMemoryJobQueue` — la cola; sin Redis cae a
    memoria avisando (`R-AR-6`).
  - `SCRAPING_QUEUE`, `SCRAPING_DEAD_QUEUE` (`scraping-jobs-dead`) — nombre de la cola y
    de la dead-letter (`R-AR-8`).
  - `createScrapingWorker`, `createRedisConnection`, `createDeadLetterQueue` — worker y
    conexiones.

No reexporta `JobQueue`, `ScrapingJobPayload` ni `normalizePriority`; los consumidores
los importan de `@ai-scraper/application-execution`.

> Los reintentos con espera creciente y el paso a la cola de muertos al agotarlos se
> gobiernan aquí (`R-SC-8`); un fallo determinista (SSRF, plan inválido) no se
> reintenta.

## Comandos

```bash
npm run build -w @ai-scraper/infrastructure-queue
docker compose up -d redis
MONGODB_MOCK=1 npm test
```
