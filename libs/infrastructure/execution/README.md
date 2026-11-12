# @ai-scraper/infrastructure-execution

El **intérprete del DSL**: ejecuta, comando a comando, lo que la IA planificó. Es
donde vive la trazabilidad de cada item extraído.

- **Capa**: ejecución.
- **Dependencias exclusivas**: `@ai-scraper/domain-ai` (los comandos), `@ai-scraper/domain-scraper`
  (`EngineMemory`), `@ai-scraper/application-execution` (puerto `EnginePageCache`),
  `@ai-scraper/shared-security` (revalidación de URLs), `@ai-scraper/shared-observability`
  (spans) y `cheerio`.
- **Superficie pública**:
  - `ExecutionEngine` — ejecuta cada comando del plan respetando el transporte
    (HTTP/Cheerio o browser) y **inyecta `_source { url, selector, scrapedAt }`** en
    cada item en el mismo punto donde se produce — `R-SC-10`, `R-SC-11`, `R-SC-12`.
  - `PageCache` — caché de páginas con TTL y tope de entradas; un acierto es una
    optimización, no una verdad — `R-SC-5`, `R-DI-5`. El puerto `EnginePageCache` que
    acepta el motor pertenece a `@ai-scraper/application-execution` (`R-HX-11`).
  - `normalizeUrlForDedupe` — clave de deduplicación de URLs dentro de un job — `R-SC-4`.
  - `fetchWithRetry`, `isRetryableError` — reintento acotado con backoff que solo toca
    errores transitorios (red, 5xx, 429); un 4xx determinista no se reintenta — `R-SC-8`.
  - `needsBrowserRender`, `detectChallenge` — heurística de render-on-demand y detección
    de anti-bot (Cloudflare/captcha); el navegador sigue siendo el plan B — `R-SC-1`.
  - `dedupeItems`, `itemKey` — dedupe de items por contenido (ignora `_source.scrapedAt`),
    para no repetir tarjetas entre páginas.
  - `FOLLOW_LINKS` hace fetch en paralelo acotado (concurrencia 3) y la memoria de URLs
    visitadas está topada (`maxVisited`, FIFO) para no crecer sin límite.
  - Fallback a **selectores aprendidos** (`deps.fallbackSelectors`, C): si `EXTRACT_LIST`
    con el selector de la IA da 0 elementos, prueba los selectores del perfil y el
    `_source.selector` refleja el que realmente extrajo — `R-SC-12`, `R-SC-14`.
  - Cortesía por host (`deps.rateLimit`, H): se espera antes de cada fetch real (nunca en
    un acierto de caché), con el host como identificador — `R-SC-7`.

El motor vuelve a recortar los límites (`clampCommandLimits`) aunque el DTO se evite
— `R-SC-2` — y comprueba `maxRuntimeSec` en cada paso del bucle — `R-SC-3`. El
resultado de un comando expone `statusCode` cuando hubo fetch real.

## Comandos

```bash
npm run build -w @ai-scraper/infrastructure-execution
node --test tests/engine.test.mjs
```
