# @ai-scraper/core

Base del sistema: los tipos y presupuestos de los que dependen todos los demás
packages y apps. No es una capa funcional, es el **punto fijo de datos**.

- **Capa**: base (la construyen primero `build:core`; ver `R-AR-4`).
- **Dependencias**: ninguna (solo `typescript` en desarrollo).
- **Superficie pública**:
  - `JobStatus` — los 11 estados del job (`CREATED`, `QUEUED`, `PLANNING`, `EXPLORING`,
    `EXECUTING`, `RECOVERING`, `INTERPRETING`, `COMPLETED`, `FAILED`, `CANCELLED`,
    `TIMEOUT`) — `R-DI-3`.
  - `DEFAULT_LIMITS`, `HARD_LIMITS` — presupuestos por defecto y topes duros — `R-DI-4`.
  - `normalizeJobLimits(input)` — deja cualquier entrada en `[1, HARD_LIMITS[key]]`;
    `0`/no finito/no numérico cae al default y **nunca** desactiva el presupuesto
    (`maxAiTokens: 0` no significa «sin límite») — `R-AI-12`.
  - `hashHtml(html)` — hash estable para detectar deriva de un sitio — `R-SC-15`.

## Comandos

```bash
npm run build -w @ai-scraper/core
node --test tests/limits.test.mjs
```
