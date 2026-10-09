# 01 — Reglas Doradas de Postgres (Prisma)

Aplica a: [`../../../prisma/schema.prisma`](../../../prisma/schema.prisma) y a las
migraciones en [`../../../prisma/migrations/`](../../../prisma/migrations/). Postgres
es la **verdad transaccional** del proyecto: jobs, sesiones, artefactos y resultados.

## Reglas

| ID | Regla |
|---|---|
| R-DB-1 | **El esquema se cambia solo con una migración de Prisma versionada**: el esquema vive en [`schema.prisma`](../../../prisma/schema.prisma) y **todo** cambio pasa por un directorio nuevo en `prisma/migrations/` generado con `npx prisma migrate dev`. Nunca se edita el esquema a mano en un entorno (ni con `db push` en prod, ni con SQL suelto en la consola): el `schema.prisma` es la fuente de verdad y las migraciones son su historia. Un cambio de modelo sin migración versionada es un cambio de esquema no reproducible → `R-AR-9`. |
| R-DB-2 | **En producción solo `prisma migrate deploy`**: el comando que aplica migraciones ya escritas. El compose ejecuta un servicio `migrate` *one-shot* (`npx prisma migrate deploy`) antes de `api`/`worker`; el flujo de despliegue lo repite (`R-CD-5`). **Prohibido** `prisma migrate dev` o `db push` fuera de desarrollo: `dev` es interactivo y `push` aplica sin historia, que es justo lo que la regla 1 prohíbe. |
| R-DB-3 | **`User.email` es único y la unicidad se resuelve en la BD, no en el código**: la restricción `@unique` en el esquema es la que garantiza que dos usuarios no compartan correo; un `if (!exists) insert` en el servicio es una carrera y no se considera validación. Cualquier otra unicidad que el dominio necesite se declara igual en el esquema. |
| R-DB-4 | **Toda clave ajena y toda columna que se consulta tiene índice**: las relaciones (`jobId`, `sessionId`, `userId`) están indexadas en el esquema, y el orden/límite de los listados se apoya en un índice sobre la columna de fecha. Una consulta nueva que filtra o ordena por una columna sin índice es un `Seq Scan` en producción: se añade el índice en el mismo cambio. |
| R-DB-5 | **Los listados paginan siempre, y la paginación por cursor va antes que `OFFSET`**: los endpoints de lista usan paginación por cursor o, en su defecto, `limit` con tope máximo. `OFFSET` grande degrada de forma lineal y en este repo las tablas crecen con cada job; se reserva para paginas de administración de tamaño acotado. La paginación **conserva los filtros**: cambiar de página no puede devolver registros que no encajan en el filtro. |
| R-DB-6 | **Las operaciones multi-tabla son transaccionales o son dos operaciones**: cuando un cambio escribe en varias tablas lógicas (p. ej. crear un `Job` y su `ScrapingPlan`, o borrar un job y sus artefactos), va en una única transacción. La coherencia de un job (o tiene todos sus artefactos o no tiene ninguno) no se deja al azar. No existe "media transacción" aceptada → `R-DI-8`. |
| R-DB-7 | **Las columnas `Json` son un contrato declarado, no un cajón**: `limits`, `payload`, `data`, `request`, `response`, `context` guardan estructura libre, pero su forma está documentada y versionada junto al código que la produce (el schema Zod del DSL y los tipos de `libs/domain/execution`). Un consumidor de un `Json` que adivina la estructura en vez de usar el tipo es un bug (`R-DI-7`). |
| R-DB-8 | **En CI el esquema se construye solo desde las migraciones versionadas**: el job de integración, cuando exista, aplica `prisma migrate deploy` contra una base efímera de job. Está prohibido aplicar el DDL sin historial (`--create-only` a mano, SQL suelto): no deja rastro reproducible ni auditable y acepta cambios de esquema que nadie ha revisado como migración (`R-EN-2`). |

## Verificación

```bash
# El esquema compila y las migraciones están al día
npx prisma validate --schema=prisma/schema.prisma
ls prisma/migrations/

# El cliente generado está al día con el esquema
npm run prisma:generate

# En producción se aplica con deploy, nunca con dev/push
grep -rn "migrate deploy\|migrate dev\|db push" docker-compose.yml package.json .github/workflows/ci.yml
```
