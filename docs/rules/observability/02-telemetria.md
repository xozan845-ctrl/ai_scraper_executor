# 02 — Reglas Doradas de Telemetría (métricas, health y dashboard)

Aplica a: [`../../../packages/observability/src/metrics.ts`](../../../packages/observability/src/metrics.ts),
[`../../../packages/redis/src/metrics.ts`](../../../packages/redis/src/metrics.ts) y a los
endpoints `GET /api/v1/metrics`, `GET /api/v1/metrics/prometheus`, `GET /api/v1/health`,
`GET /api/v1/health/ready` y `GET /api/v1/dashboard`.

## Reglas

| ID | Regla |
|---|---|
| R-TM-1 | **Cada proceso expone sus métricas y todas con el prefijo `scraper_`**: la API expone `/api/v1/metrics` (JSON con estadísticas de base de datos, de proceso y la tasa de recuperación de la IA) y `/api/v1/metrics/prometheus` (exposición en texto para Prometheus). Toda métrica nueva se registra a través de `MetricsCollector` (`inc`/`gauge`), que aplica el prefijo: crear una métrica "a pelo" fuera del collector es una métrica que no aparece en la exposición ni tiene labels de réplica. |
| R-TM-2 | **Convención de nombres: `[namespace]_[subsistema]_[nombre]_[unidad]` con guiones bajos y ASCII**: aquí el namespace es `scraper_`, el nombre va en `snake_case` y las unidades explícitas (`_total`, `_seconds`, `_bytes`). Válidos: `scraper_jobs_created_total`, `scraper_ai_tokens_total`, `scraper_uptime_seconds`. Prohibidos los genéricos (`requests`, `errores`, `cosas`) y cualquier nombre con tildes o caracteres no ASCII, que Prometheus descarta en silencio (`R-OB-3`). |
| R-TM-3 | **Labels de baja cardinalidad, y `instance` en todas**: el collector añade el label `instance` a cada serie (`INSTANCE_ID` o `hostname-pid`) para poder sumar entre réplicas con `sum by (instance)` y para saber qué réplica spoke. Nunca se usa un identificador único (`jobId`, `sessionId`, `userId`) como label: eso hace explotar la memoria del servidor de métricas. Etiquetas aceptadas: `instance`, `status`, `kind`, `provider`, `stage`. Cuando se añade una etiqueta, se comprueba que su cardinalidad está acotada. |
| R-TM-4 | **Métricas RED para lo que cuesta dinero y lo que falla**: el sistema expone **rate** (jobs creados/completados/fallidos/cancelados/reintentados, páginas raspadas, comandos ejecutados, items extraídos, peticiones y tokens de IA), **errors** (fallos de IA, reintentos, recoveries, jobs en cola de muertos) y **duration** (latencia por span: planner, llamada al LLM, fetch, browser). se separa el error de infraestructura del de negocio por el label `status`: un `4xx` del sitio objetivo y un `5xx` de nuestra infraestructura no son la misma alerta. |
| R-TM-5 | **La alerta de la cola de muertos es por crecimiento, no por existir**: que haya un job en `scraping-jobs-dead` es comportamiento normal de diseño (`R-AR-8`). La alerta se configura sobre (a) crecimiento sostenido en los últimos minutos o (b) mensajes sin procesar por encima del SLA operativo. Alertar por la mera existencia convierte cada dead-letter en un falso positivo y entrena al operador a ignorar la alerta. |
| R-TM-6 | **Lo agregado y lo local se distinguen en el nombre**: las métricas locales del proceso llevan el prefijo `scraper_` con su `instance`; las sumas entre réplicas/workers se publican en `/api/v1/metrics` bajo la clave `distributed` y en Prometheus como `scraper_distributed_*` (`R-RD-6`). Mezclarlas da lecturas falsas; el dashboard SPA muestra ambas precisamente para poder compararlas. |
| R-TM-7 | **`/api/v1/metrics/prometheus` exige API key si la autenticación está activa**: quien las raspa (Prometheus) debe enviar `x-api-key` por header. Exponer métricas de negocio sin autenticar a quien las puede usar para cartografiar el sistema sería una fuga; la regla es la misma que para el resto de rutas protegidas (`R-SE-9`). |
| R-TM-8 | **Health y readiness responden cosas distintas**: `/api/v1/health` es *liveness* (el proceso vive, no mira dependencias) y **no** debe caer porque una base de datos esté lenta: si no, un reinicio en cascada tumba el despliegue entero. `/api/v1/health/ready` es *readiness* (store y cola operativos) y devuelve **503** si fallan, comprobando de verdad (llama a `getStats()` y a `pendingCount()`). Esta separación es lo que permite que el orquestador reinicie lo que está muerto sin reiniciar lo que solo está esperando. |
| R-TM-9 | **Las alertas dicen qué hacer**: una alerta de "muchos jobs fallidos" indica si la causa probable es el proveedor de IA, el sitio objetivo, un límite de presupuesto o la persistencia; una alerta de "cola creciendo" dice si es que no hay workers o si los jobs están lentos. Una alerta que solo dice "algo va mal" no se puede accionar y acaba silenciada (`R-TM-5`). |

## Verificación

```bash
# El prefijo scraper_ y el label instance se aplican en el collector
grep -n "prefix\|instance" packages/observability/src/metrics.ts | head

# Las distributed van con su propio prefijo
grep -rn "scraper_distributed" packages apps --include=*.ts | head

# Liveness sin dependencias; readiness con 503
grep -n "check\|ready\|ServiceUnavailable" apps/api/src/health/health.controller.ts

# La idempotencia y los endpoints protegidos usan la misma auth
grep -n "ApiKeyGuard" apps/api/src/jobs/*.controller.ts apps/api/src/jobs/metrics.controller.ts
```
