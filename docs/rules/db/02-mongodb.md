# 02 — Reglas Doradas de MongoDB

Aplica a: [`../../../libs/infrastructure/mongodb/`](../../../libs/infrastructure/mongodb) (`connection.ts`,
`models.ts`, `repository.ts`, `radiography.ts`). MongoDB guarda la **memoria del
sistema**: lo que el scraper aprende de cada sitio para no empezar de cero.

> MongoDB **no** es la verdad de nada. Es una caché de conocimiento eliminable: si se
> borra, el sistema vuelve a radiografiar y sigue funcionando (`R-SC-14`).

## Reglas

| ID | Regla |
|---|---|
| R-MO-1 | **MongoDB guarda memoria, no resultados**: en MongoDB viven `SiteProfile` (selectores aprendidos, `needsBrowser`, estadísticas por dominio) y `PageRadiography` (radiografía de una página concreta: hash del HTML, conteos). Los **resultados de un job**, los comandos, los planes y los errores van en Postgres (`R-DB`). Mezclarlos rompe el modelo y hace que "borrar la memoria" borre resultados de negocio. |
| R-MO-2 | **La conexión se abre una vez, se comparte y se cierra al apagar**: la conexión la resuelve [`connection.ts`](../../../libs/infrastructure/mongodb/src/connection.ts) como singleton, la reutilizan repositorio y radiografía, y `disconnectMongo()` se llama en el apagado de la API y del worker (`R-AR-8`). Abrir un cliente por llamada agota los sockets; no cerrarlo en el apagado deja conexiones colgadas en el despliegue. |
| R-MO-3 | **Lo aprendido es una pista y su validez es medible**: un `SiteProfile` guarda, además de los selectores, el **hash del HTML** y los conteos de la radiografía, para poder detectar que el sitio cambió (deriva, `R-SC-15`). Un perfil sin esa evidencia de vigencia se trata como no fiable y no se usa para planificar directamente. |
| R-MO-4 | **Los documentos tienen índice y TTL donde corresponde**: `domain` se indexa (es la clave de consulta de `/api/v1/radiography/profile/:domain` y `/api/v1/radiography/domain/:domain/stats`), y las radiografías de página que son caché pura llevan **índice TTL** para que no crezcan sin límite. Una colección nueva sin índice sobre su campo de consulta es un `collection scan` esperando a production. |
| R-MO-5 | **Si MongoDB no responde, el sistema degrada y lo dice**: la conexión falla con un `warn` explicativo y el flujo sigue **sin memoria aprendida** (radiografía en memoria / re-intento de extracción), en lugar de tumbar el job. Se distingue "no hay Mongo" (degradación conocida, `R-AR-6`) de "Mongo devuelve error" (incidente: se registra como `JobError`, no se esconde). |
| R-MO-6 | **La radiografía real es una operación acotada y medible**: `performRadiography` recibe `maxDepth`, `maxPages` y `forceBrowser`, y respeta el mismo tipo de presupuestos que un job (`R-SC-2`). No se lanza una radiografía sin límites "a ver qué pasa": cada radiografía es trabajo de red y de browser. |

## Verificación

```bash
# Se cierra en el apagado
grep -rn "disconnectMongo" apps --include=*.ts

# La conexión es singleton, no por llamada
grep -n "let cached\|globalThis\|singleton" libs/infrastructure/mongodb/src/connection.ts

# Índices y TTL declarados en los modelos
grep -rn "index\|expireAfterSeconds" libs/infrastructure/mongodb/src/models.ts

# La degradación a memoria avisa
grep -rn "MONGODB_MOCK\|warn" libs/infrastructure/mongodb/src/connection.ts | head
```
