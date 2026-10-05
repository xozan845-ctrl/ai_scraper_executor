# 01 — El motor: transporte, presupuestos, reintentos y cancelación

Aplica a: [`../../../packages/crawler/`](../../../packages/crawler) (`crawler.service.ts`,
`pool.ts`), [`../../../packages/execution-engine/`](../../../packages/execution-engine)
(`execution-engine.ts`, `page-cache.ts`) y al bucle del agente en
[`../../../apps/worker/src/`](../../../apps/worker/src) (`agent-runner.ts`, `agent-loop.ts`,
`browser-engine.ts`, `planner.ts`, `job-processor.ts`).

## Reglas

| ID | Regla |
|---|---|
| R-SC-1 | **HTTP/Cheerio antes que browser; el browser es el plan B**: una página se pide con `safeFetchText` y se parsea con Cheerio siempre que eso baste. El navegador real (Playwright/Chromium) se lanza solo cuando la página necesita JavaScript o cuando un comando lo exige (`CLICK`, `SCROLL`, `TYPE`, `AUTHENTICATE`) o cuando la radiografía marcó el dominio como `needsBrowser`. El motivo no es estética: cada página de browser multiplica el coste y el tiempo del job, y es la vía por la que el crawler puede quedar colgado. |
| R-SC-2 | **Todo comando se ejecuta dentro del presupuesto del job, siempre**: ningún `EXTRACT_LIST` extrae más de `maxItems`, ni se siguen más de `maxPages`/`maxLinks`, ni se supera `maxDepth`. El recorte lo aplica el motor (`clampCommandLimits`) y no el planner: aunque el DTO se evitara y aunque el modelo pidiera más, el motor recorta (`R-AI-7`). Un presupuesto no respetado es un bug, no un ajuste de configuración. |
| R-SC-3 | **`maxRuntimeSec` es un plazo de muerte del job, no una sugerencia**: el job se corta al superarlo y termina en estado terminal con el error correspondiente. El motor comprueba el plazo en cada paso del bucle Observe→Think→Act, no solo al principio: un único comando de browser puede durar más que el plazo entero. |
| R-SC-4 | **Deduplicación de URLs dentro de un job**: antes de navegar se comprueba que la URL normalizada no se haya visitado ya en ese job. Sin esto, un `FOLLOW_LINKS` sobre una web paginada con enlaces cruzados se autoalimenta hasta agotar `maxRequests`. La clave de deduplicación es la URL normalizada, no la cadena cruda. |
| R-SC-5 | **La caché de páginas tiene TTL y límite de entradas, y su acierto es una optimisation, no una verdad**: `PageCache` (Redis con respaldo en memoria) guarda el HTML con `PAGE_CACHE_TTL_MS` (5 min por defecto) y como máximo `PAGE_CACHE_MAX_ENTRIES` entradas. Un acierto evita una petición; un fallo o una expiración solo cuesta una petición. La caché **no** se escribe nunca en producción con contenido que no se pueda re-obtener (p. ej. contenido de sesión autenticada) sin TTL corto → `R-DI-5`. |
| R-SC-6 | **El browser se presta y se devuelve**: el navegador se lanza una vez por job/pool y se reutiliza entre comandos (`browser pool` + semáforo de concurrencia en [`../../../packages/crawler/src/pool.ts`](../../../packages/crawler/src/pool.ts)); se cierra al terminar el job y en el apagado. No se lanza un Chromium por comando. Los contexts de navegador **no** se comparten entre jobs distintos: ahí es donde viven las credenciales de sesión (`R-SE-13`). |
| R-SC-7 | **El crawler es un buen ciudadano del sitio objetivo**: el ritmo de peticiones hacia el tercero está limitado (`CRAWLEE_MAX_REQUESTS_PER_MINUTE`, `CRAWLEE_MAX_CONCURRENCY`) y se manda un User-Agent propio. Este límite es cortesía con el tercero **y** protección contra que un job se auto-abuse; no se sube para "ir más rápido" sin medir el efecto en el presupuesto del job (`R-SC-3`). |
| R-SC-8 | **Reintento con espera creciente y cola de muertos**: un fallo puntual (red, 5xx, timeout del LLM) se reintenta con backoff hasta el máximo; agotado, el job va a la cola de muertos `scraping-jobs-dead` para inspección y relanzamiento manual (`R-AR-8`). Un fallo permanente (SSRF, plan inválido, host inalcanzable) **no** se reintenta: reintentar un error determinístico solo gasta tiempo y cuota. Un reintento explícito limpia los artefactos previos del job antes de reencolar (`R-AR-8`). |
| R-SC-9 | **El recovery sigue siendo el mismo DSL**: cuando el bucle falla, el recovery genera **comandos del DSL**, no código ni selectors fuera de esquema, y esos comandos pasan el mismo `CommandValidator` que el plan inicial (`R-AI-3`). El recovery está acotado (2 intentos por defecto) y no puede escalar los presupuestos del job (`R-SC-2`). Un recovery que "se salta" la validación es un agujero de seguridad, no una recuperación. |

## Verificación

```bash
# HTTP antes que browser: ambos transportes existen y el browser es condicional
grep -rn "CheerioCrawler\|PlaywrightCrawler" packages/crawler/src/crawler.service.ts

# El recorte se aplica en el motor, no solo en el planner
grep -rn "clampCommandLimits" apps packages --include=*.ts

# La cola de muertos y su constante
grep -rn "SCRAPING_DEAD_QUEUE" apps packages --include=*.ts

# El job es interrumpible y el apagado es limpio
grep -rn "SIGTERM\|cancel" apps/worker/src apps/api/src/main.ts | head
```
