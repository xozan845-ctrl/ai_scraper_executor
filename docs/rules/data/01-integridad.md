# 01 — Reglas Doradas de Integridad de Datos

Aplica a: los datos que el sistema produce y persiste — jobs, sus estados, sus
resultados trazables, sus llamadas al LLM y sus presupuestos — en los tres
almacenes (Postgres, MongoDB, Redis).

## Reglas

| ID | Regla |
|---|---|
| R-DI-1 | **Todo dato extraído es trazable o no se entrega**: cada item de un `Result` lleva `_source { url, selector, scrapedAt }` con el origen real, el selector que lo produjo y el instante de la extracción (`R-SC-10`..`R-SC-12`). La inyección es responsabilidad del motor y su ausencia es un fallo de datos, no un detalle de formato. Un endpoint que devuelva datos sin origen posible se considera un bug. |
| R-DI-2 | **La creación de un job es idempotente con clave del cliente**: `POST /api/v1/jobs` acepta `Idempotency-Key` y la persiste con un **ámbito por API key** (hash de la clave, o `anon` en desarrollo sin claves). Repetir la misma clave devuelve el job existente en vez de crear un segundo job con el mismo trabajo. La clave de idempotencia **no** comparte TTL con la caché: se conserva el tiempo que el cliente pueda reintentar, con un mínimo de **1 hora** (→ `R-DI-5`). |
| R-DI-3 | **Estados de `JobStatus` solo por el enum, y transiciones válidas**: los estados (`CREATED`, `QUEUED`, `PLANNING`, `EXPLORING`, `EXECUTING`, `RECOVERING`, `INTERPRETING`, `COMPLETED`, `FAILED`, `CANCELLED`, `TIMEOUT`) se escriben como los literales del enum de [`../../../packages/core/src/index.ts`](../../../packages/core/src/index.ts) (`R-NC-8`). Los estados terminales (`COMPLETED`, `FAILED`, `CANCELLED`, `TIMEOUT`) no se abandonan: un job que termina por error lo hace con su `JobError` registrado y su estado terminal. Nunca se deja un job en `EXECUTING` indefinidamente: el plazo (`maxRuntimeSec`, `R-SC-3`) y el apagado lo garantizan. |
| R-DI-4 | **Los presupuestos se normalizan con tope duro y nunca se desactivan con `0`**: `normalizeJobLimits` lleva cualquier valor de entrada a `[1, HARD_LIMITS[key]]`; un valor no numérico, no finito o `<= 0` cae al valor por defecto de `DEFAULT_LIMITS`. Así `maxAiTokens: 0` **no** significa "sin límite", sino "el presupuesto del servidor". La normalización ocurre **antes** de validar, de modo que aunque el DTO se evite (llamada interna o test) los topes se respetan → `R-AI-12`. |
| R-DI-5 | **Caché, idempotencia y métricas tienen TTL distintos, y ninguno es la verdad**: la caché de páginas y la de respuestas del LLM son cortas (5 min por defecto, `R-SC-5`); la clave de idempotencia de un job dura **al menos 1 hora**; el backlog y las métricas de la cola tienen su propia ventana. Ninguna caché de datos **persistentes** se considera fuente de verdad: si la caché se borra, el sistema reconstruye desde Postgres/Mongo o vuelve a pedir al sitio. Nunca se aplica el TTL corto de la caché al mecanismo de idempotencia ni al revés. |
| R-DI-6 | **La degradación a memoria es explícita y observable**: cuando un almacén no está disponible, se usa su implementación en memoria **y se emite un `warn` con el motivo**. Un sistema degradado es aceptable; uno degradado **en silencio** no lo es (`R-AR-6`). El estado degradado es además visible en `GET /api/v1/health/ready`, que devuelve `503` si el store o la cola fallan. |
| R-DI-7 | **Un dato que cambia de forma cambia de esquema o se declara libre**: los campos `Json` (`Result.data`, `ScrapingPlan.payload`, `Command.payload`, `AIInteraction.request/response`) guardan lo que produce la IA o el parser. Cualquier cambio en esa forma es un cambio de contrato: documenta la forma nueva, y si un consumidor la lee, actualízalo en el mismo cambio (`R-C-11`). Un `Json` nunca es excusa para que un consumidor adivine la estructura. |
| R-DI-8 | **Nada se borra en cascada de forma silenciosa y todo borrado es explícito**: los datos de un job (planes, comandos, páginas, resultados, errores, interacciones) se eliminan **juntos** al borrar el job (relación `onDelete: Cascade`), de modo que no queden resultados huérfanos que un `GET /api/v1/jobs/:id/results` no pueda explicar. Cuando se implemente retención, definirá qué se conserva para auditoría y durante cuánto tiempo, y esa definición irá en esta regla, no en un script suelto (deuda abierta). |

## Verificación

```bash
# Los estados terminal no se abandonan y el enum es la única fuente
grep -n "enum JobStatus" -A 13 packages/core/src/index.ts

# 0 en un presupuesto cae al default, no desactiva
grep -n "normalizeJobLimits" -A 12 packages/core/src/index.ts

# La idempotencia se persiste con ámbito
grep -n "idempotencyScope\|Idempotency-Key" apps/api/src/jobs/jobs.controller.ts

# El readiness refleja la degradación
grep -n "503\|ServiceUnavailable" apps/api/src/health/health.controller.ts
```
