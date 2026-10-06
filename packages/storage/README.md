# @ai-scraper/storage

La **verdad transaccional** del sistema en código: el acceso a Postgres para jobs,
sesiones y sus artefactos. Es la capa de orquestación de datos (`R-AR-2`).

- **Capa**: orquestación/datos.
- **Dependencias exclusivas**: `@prisma/client` y `@ai-scraper/core`.
- **Superficie pública**:
  - `createJobStore` / `PrismaJobStore` / `InMemoryJobStore` — el `JobStore` real
    (Prisma) o el de memoria cuando no hay `DATABASE_URL`, que **avisa** al degradar
    (`R-AR-6`, `R-DI-6`).
  - `createSessionStore` / `PrismaSessionStore` / `InMemorySessionStore` — sesiones de
    chat y sus mensajes.
  - `getPrismaClient`, `closeJobStore`, `__reset*Singleton` — cliente y ciclo de vida.

> El esquema y las migraciones viven en [`prisma/`](../../prisma) y se cambian solo con
> una migración versionada (`R-DB-1`); el `JobStore` no muta el esquema.

## Comandos

```bash
npm run build -w @ai-scraper/storage
npm run prisma:migrate:deploy
node --test tests/persistence.test.mjs
```
