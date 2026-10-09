# @ai-scraper/execution-engine

El **intérprete del DSL**: ejecuta, comando a comando, lo que la IA planificó. Es
donde vive la trazabilidad de cada item extraído.

- **Capa**: ejecución.
- **Dependencias exclusivas**: `@ai-scraper/domain-ai` (los comandos), `@ai-scraper/security`
  (revalidación de URLs), `@ai-scraper/shared-observability` (spans) y `cheerio`.
- **Superficie pública**:
  - `ExecutionEngine` — ejecuta cada comando del plan respetando el transporte
    (HTTP/Cheerio o browser) y **inyecta `_source { url, selector, scrapedAt }`** en
    cada item en el mismo punto donde se produce — `R-SC-10`, `R-SC-11`, `R-SC-12`.
  - `PageCache` — caché de páginas con TTL y tope de entradas; un acierto es una
    optimización, no una verdad — `R-SC-5`, `R-DI-5`.
  - `normalizeUrlForDedupe` — clave de deduplicación de URLs dentro de un job — `R-SC-4`.

El motor vuelve a recortar los límites (`clampCommandLimits`) aunque el DTO se evite
— `R-SC-2` — y comprueba `maxRuntimeSec` en cada paso del bucle — `R-SC-3`.

## Comandos

```bash
npm run build -w @ai-scraper/execution-engine
node --test tests/engine.test.mjs
```
