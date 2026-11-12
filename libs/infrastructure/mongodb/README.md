# @ai-scraper/infrastructure-mongodb

La **memoria** del sistema: lo que el scraper aprende de cada sitio para no empezar de
cero. No es la verdad de negocio —esa es Postgres (ver [`@ai-scraper/infrastructure-storage`](../storage/README.md))—;
si se borra, el sistema vuelve a radiografiar (`R-MO-1`, `R-SC-14`).

- **Capa**: datos.
- **Dependencias exclusivas**: `mongoose` y, del monorepo, `@ai-scraper/shared-core`,
  `@ai-scraper/domain-scraper` (tipos de selectores/paginación) y `@ai-scraper/shared-security`.
  No importa otros adaptadores: la radiografía se compone en el borde (`R-HX-12`).
- **Superficie pública**:
  - `connectMongo` / `disconnectMongo` / `getConnection` / `isMongoMock` — conexión
    singleton que se cierra en el apagado (`R-MO-2`); con `MONGODB_MOCK=1` degrada al
    mock avisando (`R-MO-5`).
  - Modelos `SiteProfile` (selectores aprendidos, `needsBrowser`, estadísticas) y
    `PageRadiography` (hash del HTML + conteos, con TTL) — `R-MO-1`, `R-MO-4`.
  - `MongoRepository` / `mongoRepo` — acceso a perfiles y radiografías.
  - `getLearnedProfile` — lectura del perfil aprendido (`R-MO-3`). La orquestación de
    la radiografía (crawl + inspección + persistencia) vive en
    `@ai-scraper/application-scraper` y recibe este repositorio como puerto.
  - `normalizeDomain` (reexportado de `security`) y `hashHtml`.

## Comandos

```bash
npm run build -w @ai-scraper/infrastructure-mongodb
docker compose up -d mongodb
node --test tests/persistence.test.mjs
```
