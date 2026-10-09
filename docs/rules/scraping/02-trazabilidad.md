# 02 — Trazabilidad: qué se guarda con cada resultado y de dónde salió

Aplica a: [`../../../libs/infrastructure/execution/src/execution-engine.ts`](../../../libs/infrastructure/execution/src/execution-engine.ts)
(la inyección de `_source`), [`../../../libs/infrastructure/mongodb/src/radiography.ts`](../../../libs/infrastructure/mongodb/src/radiography.ts)
y al consumo del resultado en la API (`GET /api/v1/jobs/:id/results`).

## Principio

> Un resultado sin origen es una afirmación sin fuente. Todo item extraído lleva
> **de dónde salió** (URL), **con qué selector** y **cuándo**. Si no se puede
> justificar de dónde vino un dato, el dato no se devuelve.

## Reglas

| ID | Regla |
|---|---|
| R-SC-10 | **Todo item extraído lleva `_source { url, selector, scrapedAt }`**: la inyección ocurre en el motor, en el mismo punto donde se produce el item, y no en la capa que lo serializa. Un item sin `_source` completo no se persiste ni se devuelve: el extractor no tiene excepción para "un item suelto". Este es el requisito de trazabilidad del proyecto y su aserción vive en `tests/engine.test.mjs`. |
| R-SC-11 | **`scrapedAt` es el instante real de la extracción, no el de la creación del job**: se sella con la hora del motor en el momento del item. Reutilizar `createdAt` del job convierte la trazabilidad en decorativa: dos páginas del mismo job acabarían con el mismo sello y no se podría distinguir qué se leyó cuándo. |
| R-SC-12 | **`selector` es el selector que realmente produjo el item**: se guarda el selector emitido (ya validado), no uno "equivalente" ni el que el modelo sugirió después. Si el item salió de un link y no de un selector de lista, el selector refleja esa fuente. Sin selector real, el item no cumple la trazabilidad. |
| R-SC-13 | **Un resultado se persiste una sola vez y es idempotente**: los reintentos y el relanzamiento manual limpian los artefactos previos (`clearJobArtifacts`) antes de volver a ejecutar, de modo que reejecutar no duplica `Result`, `Command` ni `Page` del job. La clave de idempotencia de la creación del job (`Idempotency-Key` con ámbito por API key) impide además que dos peticiones idénticas creen dos jobs → `R-DI-2`. |
| R-SC-14 | **La radiografía es memoria, no verdad de negocio**: `performRadiography` y `getLearnedProfile` escriben en MongoDB (`SiteProfile`, `PageRadiography`) lo aprendido de un dominio para planificar más rápido la próxima vez. Es una **caché de conocimiento**: si se borra, el sistema vuelve a radiografiar y sigue funcionando. Nunca se toma un dato de negocio solo de un perfil aprendido sin pasarlo por el pipeline de extracción normal (`R-AI-16`). |
| R-SC-15 | **La deriva del sitio se detecta y se registra**: la radiografía calcula un hash del HTML y unos conteos; si cambian respecto a la anterior, es una señal de que el sitio cambió y los selectores aprendidos pueden estar viejos. La deriva se expone en las estadísticas del dominio (`GET /api/v1/radiography/domain/:domain/stats`) para que la decisión de re-radiografiar sea visible, no un efecto secundario. |
| R-SC-16 | **`GET /api/v1/jobs/:id/results` devuelve lo persistido con su `_source`, no un render en vivo**: la API lee de `Result` y devuelve `data` junto con `sourceUrl`, `selector` y `confidence`. No se reconstruye el resultado reejecutando el scraping al vuelo: la API no ejecuta jobs (`R-AR-3`). `confidence` refleja completitud/validación del item, no una promesa de veracidad absoluta. |

## Verificación

```bash
# La inyección de _source está en el motor (no en la capa HTTP)
grep -n "_source" libs/infrastructure/execution/src/execution-engine.ts

# El sello es la hora de la extracción
grep -n "scrapedAt" libs/infrastructure/execution/src/execution-engine.ts

# La limpieza de artefactos antes de reintentar
grep -rn "clearJobArtifacts" apps packages --include=*.ts

# La deriva del sitio se calcula y se expone
grep -rn "htmlHash\|drift" libs/infrastructure/mongodb/src apps/api/src --include=*.ts | head
```
