# @ai-scraper/infrastructure-storage

Adaptadores de persistencia para jobs, sesiones y sus artefactos. La verdad
transaccional usa Postgres; memoria permite tests y desarrollo sin base real.

- **Capa**: infraestructura.
- **Dependencias exclusivas**: `@prisma/client` y
  `@ai-scraper/application-execution`, que es propietario de los puertos (`R-HX-11`).
- **Superficie pública**:
  - `createJobStore` / `PrismaJobStore` / `InMemoryJobStore` — adaptadores de `JobStore`
    (Prisma) o el de memoria cuando no hay `DATABASE_URL`, que **avisa** al degradar
    (`R-AR-6`, `R-DI-6`).
  - `createSessionStore` / `PrismaSessionStore` / `InMemorySessionStore` — sesiones de
    chat y sus mensajes.
  - `getPrismaClient`, `closeJobStore`, `__reset*Singleton` — cliente y ciclo de vida.

No reexporta `JobStore`, `SessionStore` ni sus DTOs; los consumidores los importan de
`@ai-scraper/application-execution`.

> El esquema y las migraciones viven en [`prisma/`](../../prisma) y se cambian solo con
> una migración versionada (`R-DB-1`); el `JobStore` no muta el esquema.

## Comandos

```bash
npm run build -w @ai-scraper/infrastructure-storage
npm run prisma:migrate:deploy
MONGODB_MOCK=1 npm test
```
