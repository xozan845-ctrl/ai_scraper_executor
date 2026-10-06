# @ai-scraper/mongodb

La **memoria** del sistema: lo que el scraper aprende de cada sitio para no empezar de
cero. No es la verdad de negocio —esa es Postgres (ver [`@ai-scraper/storage`](../storage/README.md))—;
si se borra, el sistema vuelve a radiografiar (`R-MO-1`, `R-SC-14`).

- **Capa**: datos.
- **Dependencias exclusivas**: `mongoose` y, del monorepo, `@ai-scraper/core`,
  `@ai-scraper/crawler`, `@ai-scraper/execution-engine` y `@ai-scraper/security`.
- **Superficie pública**:
  - `connectMongo` / `disconnectMongo` / `getConnection` / `isMongoMock` — conexión
    singleton que se cierra en el apagado (`R-MO-2`); con `MONGODB_MOCK=1` degrada al
    mock avisando (`R-MO-5`).
  - Modelos `SiteProfile` (selectores aprendidos, `needsBrowser`, estadísticas) y
    `PageRadiography` (hash del HTML + conteos, con TTL) — `R-MO-1`, `R-MO-4`.
  - `MongoRepository` / `mongoRepo` — acceso a perfiles y radiografías.
  - `performRadiography` / `getLearnedProfile` — radiografía real acotada por
    `maxDepth`/`maxPages` (`R-MO-6`) y lectura del perfil aprendido (`R-MO-3`).
  - `normalizeDomain` (reexportado de `security`) y `hashHtml`.

## Comandos

```bash
npm run build -w @ai-scraper/mongodb
docker compose up -d mongodb
node --test tests/persistence.test.mjs
```
