# 02 — Reglas de Tests de Integración (API + almacén real)

Aplica a: pruebas que levantan la API NestJS real (o módulos reales con la capa de
datos real) y ejecutan peticiones HTTP contra un **almacén real** (Postgres para el
`JobStore`, Mongo para los perfiles) en lugar de dobles.

> Los dobles en los tests de lógica prueban los dobles. Una prueba con Postgres real
> es la única que valida que el `schema.prisma`, las migraciones, los índices y las
> consultas del `JobStore` funcionan juntos — y esa cadena es justo lo que se rompe en
> un despliegue.

## Alcance mínimo por endpoint

| ID | Regla |
|---|---|
| R-I-1 | Todo endpoint `GET/POST/DELETE` de la API tiene **al menos un test de integración** de camino feliz con almacén real: se crea el dato por la vía real, y se comprueba que vuelve por la respuesta. Para este repo eso significa, como mínimo, el ciclo de vida del job (`POST /api/v1/jobs` → `GET /api/v1/jobs/:id` → `GET /api/v1/jobs/:id/results`) y el de la sesión (`POST /api/v1/sessions` → `GET /api/v1/sessions/:id`). |
| R-I-2 | **Endpoints con filtro o paginación** tienen tests que (a) insertan datos con orden conocido, (b) filtran, (c) asertan el conjunto **exacto** devuelto (conteo e identificadores), y (d) verifican que la paginación **conserva los filtros**. En este repo eso es el filtro por `status` y la paginación por cursor de `GET /api/v1/jobs` (`R-DB-5`). |
| R-I-3 | **Fechas y zonas horarias**: todo filtro por fecha se prueba con datos que cruzan la medianoche local, asertando contra el día local configurado (`TZ`), no contra UTC. En la práctica, `createdAt` de los jobs y `scrapedAt` de los resultados son los dos sitios donde un `Z` mal puesto cambia el día de un registro. |

## Autenticación y autorización

| ID | Regla |
|---|---|
| R-I-4 | **Cada endpoint protegido tiene test de acceso denegado:** sin `x-api-key` → `401`; con clave inválida → `401`. Y con `NODE_ENV=production` **sin** `API_KEYS` → `401` en todos ellos (el comportamiento fail-closed, `R-SE-9`). Este es el test que demuestra que la política de seguridad de la API existe de verdad, no solo en el código. |
| R-I-5 | **El ciclo de vida de la autenticación de usuario se prueba contra la BD real**: el registro del primer usuario (`POST /api/v1/auth/register-first`) y que la clave devuelta autentica una ruta protegida. Con el almacén caído, una clave de usuario **no** autoriza (`R-SE-10`). |
| R-I-6 | **Payload inválido → `400`** con el shape de error conocido. Un DTO sin validación detectable es un agujero de *mass assignment* (`R-DS-4`), y el test es lo que lo detecta: se manda un campo extra (`status`, `userId`) y se comprueba que se ignora. |
| R-I-7 | **Recurso inexistente → `404`**, y conflicto (p. ej. segundo registro del primer usuario) → `409`. |
| R-I-8 | **Un fallo de escritura no deja datos residuales**: si crear un job falla a mitad, no queda un `Job` sin `Plan`, ni una `Session` a medio crear. Se comprueba con una consulta de conteo tras el error (rollback real, no lógica). |

## Datos y aislamiento

| ID | Regla |
|---|---|
| R-I-9 | **Cada test crea y limpia sus propios datos.** Se identifica cada job/sesión creado con un sufijo único (el `correlationId` sirve) y se consulta por ese sufijo; nunca se depende del estado que dejó otro test. La base de CI se recrea por job (`R-EN-2`). |
| R-I-10 | **El seed de test incluye datos límite:** un job en cada estado terminal, un job sin ningún resultado, una sesión en `RADIOGRAPHY` y otra en `READY`, una sesión con credenciales y otra sin ellas, y resultados con y sin `sourceUrl`. Los casos límite son el objetivo del seed; los fáciles no lo son. |
| R-I-11 | **Las consultas de `JobStore`/`SessionStore` se prueban contra la BD real** por lo menos una vez: el orden y el límite de los listados, el filtrado por estado, la lectura de resultados con su `sourceUrl`. Es donde se detecta un mapeo de columna o un nombre mal escrito que contra dobles nunca falla. |
| R-I-12 | **Ejecutable con un comando y en CI, con almacén efímero de job.** Hoy esta capa no tiene suite ni job (deuda `G-4`, ver `06-estandares-cobertura.md`); el día que exista, el comando queda como script de `package.json` y el job levanta su propio Postgres con el esquema desde las migraciones versionadas (`R-EN-2`). |
| R-I-13 | **La prueba no necesita red externa ni LLM real.** Un test de integración contra Postgres y Mongo reales es integración; si además necesita OpenRouter, ya es E2E (`03-reglas-e2e.md`). El proveedor de IA se dobla en esta capa. Los bordes se doblan **por el lado del cliente** (fetch, LLM), pero el resto —Postgres, Mongo, la API NestJS, el `JobStore`, la validación, los guards— es real. |

## Verificación

```bash
# El almacén efímero de un job de integración
docker compose up -d postgres mongodb
npm run prisma:migrate:deploy

# La API real, sin dobles, contra ella
npm run dev:api   # y en otra terminal, las peticiones del test

# Comprobar que una escritura fallida no deja filas a medias
npx prisma db execute --stdin <<< 'select count(*) from "Job"'
```
