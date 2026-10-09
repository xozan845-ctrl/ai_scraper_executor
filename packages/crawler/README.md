# @ai-scraper/crawler

El **transporte y el navegador**: peticiones HTTP y Playwright con el guard de
navegación. Es la única pieza que habla con el sitio objetivo.

- **Capa**: ejecución.
- **Dependencias exclusivas**: `@ai-scraper/shared-core`, `@ai-scraper/shared-security`, `cheerio`,
  `crawlee` y `playwright`.
- **Superficie pública**:
  - `CrawlerService` — híbrido HTTP/Cheerio y Playwright; el navegador es el plan B
    (`R-SC-1`) y `interact()` cubre `CLICK`/`SCROLL`/`TYPE`/`AUTHENTICATE`.
  - `BrowserPool`, `Semaphore` — reutiliza Chromium entre jobs y acota la concurrencia
    (`R-SC-6`).
  - `installNavigationGuard(page)` — aborta redirects y subrecursos hacia hosts
    privados/metadata, también dentro del navegador (`R-SE-1`, `R-SE-8`).
  - `CANDIDATE_SELECTORS`, `hashHtml` — pistas de extracción y huella de HTML.

> Cada paso por el navegador multiplica coste y tiempo: la política de ciudadanía con
> el tercero (`CRAWLEE_MAX_REQUESTS_PER_MINUTE`, `CRAWLEE_MAX_CONCURRENCY`) vive aquí
> — `R-SC-7`.

## Comandos

```bash
npm run build -w @ai-scraper/crawler
node --test tests/crawler.test.mjs tests/browser.test.mjs tests/browser-ssrf.test.mjs
```
