# @ai-scraper/queue

La **cola de trabajos**: BullMQ sobre Redis con respaldo en memoria, incluida la cola
de muertos. Es lo que permite que la API solo encole y el worker consuma (`R-AR-3`).

- **Capa**: orquestación.
- **Dependencias exclusivas**: `bullmq` e `ioredis`.
- **Superficie pública**:
  - `createJobQueue` / `BullMQJobQueue` / `InMemoryJobQueue` — la cola; sin Redis cae a
    memoria avisando (`R-AR-6`).
  - `SCRAPING_QUEUE`, `SCRAPING_DEAD_QUEUE` (`scraping-jobs-dead`) — nombre de la cola y
    de la dead-letter (`R-AR-8`).
  - `createScrapingWorker`, `createRedisConnection`, `createDeadLetterQueue` — worker y
    conexiones.
  - `normalizePriority` — prioridad acotada del job.

> Los reintentos con espera creciente y el paso a la cola de muertos al agotarlos se
> gobiernan aquí (`R-SC-8`); un fallo determinista (SSRF, plan inválido) no se
> reintenta.

## Comandos

```bash
npm run build -w @ai-scraper/queue
docker compose up -d redis
node --test tests/retry-cleanup.test.mjs
```
