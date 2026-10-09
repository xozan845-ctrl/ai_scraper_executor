# @ai-scraper/domain-execution

Bounded context de **ejecución**: entidades y presupuestos del ciclo de vida de un
job. Dominio **puro** — sin frameworks, sin I/O y sin dependencias de otras capas
(`R-HX-1`, `R-HX-3`).

- **Capa**: `libs/domain/execution`.
- **Dependencias**: ninguna (solo `typescript` en desarrollo).
- **Superficie pública**:
  - `JobStatus` — los 11 estados del job (`CREATED`, `QUEUED`, `PLANNING`, `EXPLORING`,
    `EXECUTING`, `RECOVERING`, `INTERPRETING`, `COMPLETED`, `FAILED`, `CANCELLED`,
    `TIMEOUT`) — `R-DI-3`.
  - `JobLimits`, `DEFAULT_LIMITS`, `HARD_LIMITS` — presupuestos por defecto y topes duros — `R-DI-4`.
  - `normalizeJobLimits(input)` — deja cualquier entrada en `[1, HARD_LIMITS[key]]`;
    `0`/no finito/no numérico cae al default y **nunca** desactiva el presupuesto
    (`maxAiTokens: 0` no significa «sin límite») — `R-AI-12`.
  - `CreateJobInput`, `JobRecord` — forma de creación y de registro de un job.

## Comandos

```bash
npm run build -w @ai-scraper/domain-execution
node --test tests/limits.test.mjs tests/property.test.mjs
```
