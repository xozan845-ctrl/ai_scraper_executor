# 03 — Reglas Doradas de Redis

Aplica a: [`../../../packages/redis/`](../../../packages/redis) (`cache.ts`,
`ratelimit.ts`, `metrics.ts`, `kv.ts`) y a [`../../../packages/queue/`](../../../packages/queue)
(`bullmq-queue.ts`, `memory-queue.ts`). Redis mueve el sistema: la cola de jobs, la
caché de páginas y de respuestas del LLM, el rate limiting y las métricas agregadas
entre réplicas.

> Redis guarda **estado volátil**. Su pérdida se nota (se pierden cachés y contadores)
> pero **no se pierden datos de negocio**: eso es Postgres (`R-DB`) y MongoDB
> (`R-MO`). Por eso todo lo que está en Redis tiene que poder desaparecer sin dejar
> basura.

## Reglas

| ID | Regla |
|---|---|
| R-RD-1 | **Redis es broker y caché, y esa cohabitación es una deuda conocida**: BullMQ usa Redis como cola, y el mismo Redis sirve la caché de páginas, la del LLM, el rate limit y los contadores. Funciona, pero implica que una operación de mantenimiento (`FLUSHALL`) **tumba los jobs en vuelo**. Mientras siga así, ninguna tarea de mantenimiento ejecuta `FLUSHALL` sobre el Redis de un entorno con jobs corriendo; se separan por prefijo de clave o por instancia, y la separación definitiva es un cambio normativo con su ADR (`R-AR-9`). |
| R-RD-2 | **Toda clave lleva prefijo de dominio y TTL explícito**: cada familia de claves se escribe con su prefijo (`cache:`, `idem:`, `ratelimit:`, `metrics:`, la cola de BullMQ) para que un `SCAN` de diagnóstico sepa de quién es cada clave y para que dos families no colisionen. Toda clave que no sea de BullMQ **lleva TTL explícito**: una clave sin TTL en Redis es una fuga de memoria con forma de dato. |
| R-RD-3 | **La caché de Redis no es la verdad y su pérdida no es un error**: un fallo al leer o escribir la caché degrada el rendimiento, no la corrección. El sistema pide al sitio de nuevo o recalcula. La caché de páginas (`PageCache`) usa TTL corto por defecto y nunca guarda contenido de sesión autenticada sin TTL corto (`R-SC-5`, `R-DI-5`). |
| R-RD-4 | **El rate limit es compartido entre réplicas, no por proceso**: `RedisRateLimiter` usa ventana deslizante sobre Redis con respaldo en memoria, de modo que el límite por IP (`RATE_LIMIT_CREATE_PER_MIN`) vale para **todas** las réplicas de la API juntas. Si el límite viviera en memoria, `--scale api=N` multiplicaría el límite por N y `R-SE-15` sería falsa. |
| R-RD-5 | **Si Redis no responde, el respaldo en memoria avisa y el sistema sigue**: el modo memoria de caché, rate limit y métricas entra con un `warn` con el motivo (`R-AR-6`, `R-DI-6`). En el caso del **rate limit**, degradar a memoria significa que el límite pasa a ser por réplica: es aceptable para no dejar la API abierta, pero es una degradación que se dice en voz alta. |
| R-RD-6 | **Los contadores agregados no se mezclan entre réplicas sin `instance`**: las métricas de proceso llevan el label `instance` y las agregadas por Redis llevan el prefijo `scraper_distributed_*`, de forma que en Grafana se distingue "mi réplica" de "la suma de todas" (`R-TM-4`). Métricas que mezclan las dos fuentes sin distinguir dan lecturas falsas y una alarma inútil. |

## Verificación

```bash
# Toda familia de claves con prefijo y TTL
grep -rn "prefix\|expire\|setex" packages/redis/src/*.ts | head

# El rate limit es compartido (Redis), no por proceso
grep -n "redis\|MULTI\|expire" packages/redis/src/ratelimit.ts | head

# El respaldo en memoria de la cola y del store avisa
grep -rn "InMemory\|warn" packages/queue/src/factory.ts packages/queue/src/memory-queue.ts | head

# Prefijos de métricas: local vs distribuida
grep -rn "scraper_distributed\|instance" packages/redis/src/metrics.ts | head
```
