# @ai-scraper/domain-scraper

Bounded context de **scraping**: value objects de la trazabilidad de cada item
extraído (`_source` con url/selector/fecha). Dominio **puro** (`R-HX-1`, `R-HX-3`).

- **Capa**: `libs/domain/scraper`.
- **Dependencias**: ninguna (solo `typescript` en desarrollo).
- **Superficie pública**:
  - `EngineMemory` — memoria de trayectoria del job (URLs visitadas, último paso,
    selectores aprendidos) — ADR-35.
  - `TracedValue<T>` — un valor extraído con su `source { url, selector?, scrapedAt, confidence? }` (trazabilidad §33, `R-SC-10..16`).
  - `StructuredItem` — un item compuesto de `TracedValue`s.

## Comandos

```bash
npm run build -w @ai-scraper/domain-scraper
node --test tests/engine.test.mjs tests/crawler.test.mjs
```
