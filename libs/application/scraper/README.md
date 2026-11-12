# @ai-scraper/application-scraper

Casos de uso del **workflow de scraping**: planificar, ejecutar el bucle
Observe→Think→Act con recovery, interpretar resultados y procesar un job completo.
No conoce Nest, BullMQ, Mongo, Crawlee ni Playwright: recibe puertos y adaptadores
desde `apps/worker` (`R-HX-10`).

- **Capa**: aplicación (`libs/application/scraper`).
- **Dependencias**: `application-ai`, `application-execution`, `domain-ai`,
  `domain-execution`, `domain-scraper` y `shared-observability` (solo métricas locales).
- **Superficie pública**:
  - `generatePlan` — planifica con el `AIOrchestrator` inyectado, valida el DSL y
    recorta límites; usa `SiteMemory` opcional para el perfil aprendido.
  - `AgentRunner` — bucle §47 con recovery §28, trayectoria/anti-oscilación, deadline y
    presupuesto de tokens; recibe `createEngine` y `SiteMemory` por constructor.
  - `processJob` — orquesta el runner, persiste artefactos §40 e interpreta resultados;
    recibe orquestador, motor, métricas y credenciales ya compuestos en el borde.
  - `enrichItems` — normalización/confianza/dedupe determinista de resultados.
  - `performRadiography` — crawler + inspección + persistencia del perfil vía puertos
    (`SiteCrawler`, `ScraperEngine`, `RadiographyProfileRepository`); Mongo ya no
    importa crawler/execution.
  - `runHeuristicAgentLoop` — loop determinista sin IA para `DEMO_URL`.
  - Puertos: `ScraperEngine`/`CreateScraperEngine`, `SiteMemory`, `ScraperMetrics`,
    `SiteCrawler`, `RadiographyProfileRepository`.

## Comandos

```bash
npm run build -w @ai-scraper/application-scraper
MONGODB_MOCK=1 npm test
```
