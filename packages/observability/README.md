# @ai-scraper/observability

Logs estructurados y métricas: la capa que hace **seguible** un job de extremo a
extremo. No depende de nada.

- **Capa**: transversal (API, worker y todos los packages).
- **Dependencias**: ninguna (solo `typescript` en desarrollo).
- **Superficie pública**:
  - `logger`, `log`, `withSpan` — JSON de una línea por evento (`ts`, `level`, `msg`,
    `instance`, contexto del job) — `R-OB-1`, `R-OB-6`.
  - `runWithContext`, `getContext`, `updateContext` — propagan el `correlationId` por
    `AsyncLocalStorage` (API → cola → worker) — `R-OB-2`.
  - `metrics`, `MetricsCollector`, `instanceId` — contadores y gauges con prefijo
    `scraper_` y label `instance`; toda métrica se registra por aquí, nunca «a pelo»
    — `R-TM-1`, `R-TM-3`.

## Comandos

```bash
npm run build -w @ai-scraper/observability
node --test tests/observability.test.mjs tests/logging.test.mjs tests/metrics-labels.test.mjs
```
