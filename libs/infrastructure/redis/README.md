# @ai-scraper/infrastructure-redis

El **estado volátil** del sistema: caché de páginas y de respuestas del LLM, rate
limit y agregación de métricas. Todo lo que hay aquí puede desaparecer sin perder
datos de negocio (`R-RD-3`).

- **Capa**: datos.
- **Dependencias exclusivas**: `ioredis`.
- **Superficie pública** (cada familia con su prefijo de clave y TTL explícito — `R-RD-2`):
  - Cliente: `getRedisClient`, `getRedisSubscriber`, `connectRedis`, `disconnectRedis`,
    `isRedisHealthy`, `Redis`.
  - Caché de páginas: `RedisPageCache` / `MemoryPageCache` / `getPageCache` — TTL corto;
    un fallo solo cuesta una petición (`R-SC-5`, `R-RD-3`).
  - Rate limit: `RedisRateLimiter` / `MemoryRateLimiter` / `getRateLimiter` — ventana
    deslizante **compartida entre réplicas** (`R-RD-4`, `R-SE-15`).
  - Métricas agregadas: `RedisMetricsAggregator` / `MemoryMetricsAggregator` /
    `getMetricsAggregator` — suman entre réplicas (`scraper_distributed_*`, `R-RD-6`).
  - Caché JSON: `RedisJsonCache` / `MemoryJsonCache` / `getJsonCache` — respuestas del
    LLM e idempotencia (`R-AI-13`, `R-DI-2`).

> Si Redis no responde, cada modo entra en su respaldo en memoria **con un `warn`**
> (`R-RD-5`); el rate limit pasa a ser por réplica y se dice.

## Comandos

```bash
npm run build -w @ai-scraper/infrastructure-redis
docker compose up -d redis
node --test tests/cache-isolation.test.mjs
```
