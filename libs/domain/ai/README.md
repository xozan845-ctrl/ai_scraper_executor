# @ai-scraper/domain-ai

El **DSL** que la IA puede emitir y su validación. Es la frontera entre «qué decide
el modelo» y «cómo lo ejecuta el motor» (`R-AR-1`).

- **Capa**: `libs/domain/ai` (dominio puro; la consumen `execution-engine`, `ai`/`ai-providers` y `apps/worker`).
- **Dependencias exclusivas**: `@ai-scraper/shared-security` (shared kernel: valida toda URL del plan) y `zod`.
- **Superficie pública**:
  - `CommandType` — los **19** comandos (`NAVIGATE`, `EXTRACT`, `EXTRACT_LIST`,
    `EXTRACT_TABLE`, `EXTRACT_TEXT`, `EXTRACT_STRUCTURED`, `EXTRACT_NETWORK`,
    `FOLLOW_LINKS`, `PAGINATE`, `SCROLL`, `CLICK`, `TYPE`, `WAIT`, `FINISH`,
    `AUTHENTICATE`, `GET_ATTRIBUTE`, `INSPECT_PAGE`, `INSPECT_LINKS`,
    `INSPECT_ELEMENTS`) — `R-AI-1`.
  - `ScrapingCommandSchema`, `ScrapingPlanSchema` — esquemas Zod estrictos — `R-AI-3`.
  - `CommandValidator` — valida el plan entero (esquema, dominio, allowlist, SSRF,
    presupuestos); un comando que viola algo hace fallar el plan — `R-AI-3`, `R-AI-5`.
    La política de hosts privados se **inyecta** (`allowPrivateHosts`), de modo que el
    dominio no lee `process.env` (`R-HX-13`).
  - `normalizeRawCommand`, `normalizeRawPlan` — corrigen desviaciones conocidas del
    modelo **antes** de validar; un comando inventado se descarta — `R-AI-4`.
  - `clampCommandLimits` — recorta los límites de cada comando al del job; el motor
    es el segundo punto de recorte — `R-AI-7`, `R-SC-2`.

## Comandos

```bash
npm run build -w @ai-scraper/domain-ai
node --test tests/dsl.test.mjs tests/normalize.test.mjs tests/property.test.mjs
```
