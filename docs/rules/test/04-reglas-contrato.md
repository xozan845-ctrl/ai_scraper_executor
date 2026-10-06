# 04 — Reglas de Contrato de API

Aplica a: la forma de los payloads de `/api/v1/**` y a su documentación Swagger (que se
genera de los DTOs). Los consumidores —un cliente web tipo chat, el cliente real de
`scripts/` y los propios tests— dependen de estos contratos; un cambio inesperado
rompe al cliente sin fallar ningún test unitario.

> **Práctica real del repo:** la API expone objetos planos (no un envelope universal
> `{ data, meta }` como en el proyecto de origen). Estas reglas norman la forma que
> **existe**: prefijo `/api/v1`, errores de Nest, y el envelope de sesión que el flujo
> de chat sí documenta. Un envelope nuevo para todo, si algún día se quiere, es un
> cambio normativo explícito.

## Rutas y versionado

| ID | Regla |
|---|---|
| R-C-1 | **Todo lo público vive bajo `/api/v1`**: el `setGlobalPrefix('api/v1')` de `apps/api/src/main.ts` es la frontera y **no tiene excepción** — ni siquiera la infraestructura: liveness y readiness cuelgan del mismo prefijo (`GET /api/v1/health`, `GET /api/v1/health/ready`), igual que Swagger en `/api/v1/docs`. Es lo que espera el `HEALTHCHECK` del `Dockerfile` de la API. Un endpoint nuevo que cuelgue de otra raíz rompe la convención de los clientes y el healthcheck del contenedor. |
| R-C-2 | **Toda ruta nueva se documenta y se declara en Swagger desde su DTO**: la documentación se genera con `@nestjs/swagger` (`DocumentBuilder`, `SwaggerModule` en `/api/v1/docs`), no se escribe a mano. Un endpoint sin decoradores ni DTO es invisible para el cliente y para el contrato. |
| R-C-3 | **Cambios incompatibles solo en `/api/v2`.** Renombrar o eliminar un campo, o cambiar su tipo, es incompatible y requiere versión nueva. Un campo nuevo **compatible** sí puede entrar en `v1` si actualiza a la vez a quien lo consume (`R-C-11`). |

## Forma de la respuesta

| ID | Regla |
|---|---|
| R-C-4 | **Las respuestas exponen DTOs, nunca filas de persistencia crudas.** El DTO declara los campos y la forma; la entidad Prisma o el documento Mongo con campos internos (`credentials` cifrado, campos de control) no sale nunca. El `SELECT`/`find` nombra lo que se expone (`R-DS-5`). |
| R-C-5 | **La forma de cada respuesta es estable y comprobable:** los endpoints de lectura devuelven el mismo shape de claves y tipos siempre, incluidos los casos límite (lista vacía = `[]`, no `null`; campo opcional ausente, no `""`). Un cliente no debería tener que preguntar "¿esto viene o no viene?". |
| R-C-6 | **La trazabilidad viaja en la respuesta cuando el dato la tiene.** `GET /api/v1/jobs/:id/results` devuelve los items con su `_source` (`url`, `selector`, `scrapedAt`); `GET /api/v1/jobs/:id/execution` devuelve comandos, páginas y errores; `GET /api/v1/jobs/:id/ai` devuelve las interacciones con LLM (tokens, latencia). Estas endpoints son la vía por la que un resultado es auditable; omitirlos es quitarle la trazabilidad al consumidor (`R-SC-16`). |

## Fechas

| ID | Regla |
|---|---|
| R-C-7 | **Todas las fechas de la API son ISO 8601 UTC con `Z`** (`2026-10-05T14:44:35.000Z`). El contrato rechaza un offset distinto de `Z` o un timestamp sin normalizar. Esto incluye `createdAt`, `updatedAt`, `scrapedAt` y los `span`/latencias. |
| R-C-8 | **La semántica de los límites de un job va documentada en el contrato**, en particular que `limits.maxRuntimeSec` es un plazo de muerte (`R-SC-3`) y que `maxAiTokens: 0` no desactiva el presupuesto sino que toma el del servidor (`R-DI-4`). Un cliente que cree que `0` = infinito provocará un incidente de coste. |

## Errores

| ID | Regla |
|---|---|
| R-C-9 | **Los errores tienen una forma consistente**: los `HttpException` de Nest serializan con su shape (`statusCode`, `message`, y el objeto cuando lo hay, como el `503` de readiness con su `checks`). Los errores de negocio del LLM se exponen con un mensaje accionable (`409`/`422` según el caso), nunca con un stack. El cliente debe poder distinguir "mi petición fue mala" (4xx) de "el sistema no pudo" (5xx). |
| R-C-10 | **Nada de detalle interno en un error de producción**: en `NODE_ENV=production` un `5xx` no expone stack, SQL ni la URL interna que falló. El detalle va al log (con `correlationId`) y la respuesta lleva solo un mensaje seguro. |

## Automatización

| ID | Regla |
|---|---|
| R-C-11 | **Un campo nuevo implica actualizar a quien lo consume en el mismo cambio**: campo en el DTO + su decorator de Swagger + el test de contrato/forma que lo comprueba + el cliente de `scripts/` o el README si lo documentan. Añadir un campo que un consumidor activo no conoce es cómo se rompen las integraciones en silencio. |
| R-C-12 | **La spec está versionada y en sync con la API**: `docs/openapi.json` es la fuente que un consumidor puede leer, y `npm run openapi:check` (paso `OpenAPI spec in sync` de CI) falla si la API genera una spec distinta. Cualquier cambio de DTO o ruta se exporta con `npm run openapi:export` y se commitea junto al cambio. La capa de **contrato** como suite de aserciones existe además en `tests/contract.test.mjs` (paso `Contract`, `G-5`), que recorre los endpoints críticos y valida sus formas; cada endpoint nuevo debe traer su asertación de forma en el fichero de test que le corresponde. |

## Verificación

```bash
# El prefijo global y Swagger
grep -n "setGlobalPrefix\|SwaggerModule" apps/api/src/main.ts

# Los endpoints declaran su operación y su contrato
grep -rn "@ApiOperation\|@ApiResponse\|@ApiHeader" apps/api/src --include=*.ts | head

# Nada devuelve la fila cruda de persistencia (credentials no sale)
grep -rn "credentials" apps/api/src/jobs/*.ts
```
