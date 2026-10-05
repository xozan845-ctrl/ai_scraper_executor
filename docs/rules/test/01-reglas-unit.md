# 01 — Reglas de Unit Tests

Aplica a: los tests de [`../../../tests/`](../../../tests) que ejercitan lógica sin
salir a la red ni a un almacén real: el DSL y su normalizador, el motor de ejecución,
el crawler, los proveedores de IA, los límites, la seguridad, la observabilidad y los
stores en memoria.

> **Cómo se ejecuta un test aquí:** ficheros `tests/*.test.mjs` con el runner nativo
> (`node --test`), usando `node:test` (`describe`/`it`) y `node:assert`. Sin Jest, sin
> `@testing-library`, sin `ts-jest`. Los dobles se escriben a mano o con el
> `http.createServer` local; `fetch` se sustituye cuando la prueba lo requiere.

## Semántica del requisito

| ID | Regla |
|---|---|
| R-U-1 | **Assert contra el requisito, no contra la implementación.** Si cambia la implementación pero el requisito no, el test no debe cambiar (y al revés). Prohibido "actualizar el expected para que pase". Ejemplo canónico de este repo: el test de trazabilidad aserta que cada item lleva `_source { url, selector, scrapedAt }` —el requisito— y no que "se llame a `result.data.push`". |
| R-U-2 | **El nombre dice comportamiento y condición**: `debe <comportamiento> cuando <condición>` (`debe normalizar a NAVIGATE cuando el modelo devuelve action:navigate`). Nunca `test 1`, `should work`, `ok`. Con `node:test` el nombre es el string que se pasa a `it()`. |
| R-U-3 | **Un test, una situación.** Nada de "y" concatenando escenarios en un solo `it`: dos comportamientos son dos tests, porque si uno falla hay que saber cuál. |
| R-U-4 | **El test tiene que poder fallar.** Si se elimina la lógica bajo prueba, el test falla. Prohibidos los asserts triviales (`assert.ok(true)`, "solo assert que no lanza" cuando la función no hace nada observable). Un test que verifica que un número es un número no prueba nada. |

## Fechas, números y límites

| ID | Regla |
|---|---|
| R-U-5 | **Toda lógica de fecha/hora se testea con `TZ` explícita.** El requirement es "ISO 8601 UTC con `Z`" y "sello de extracción en el momento de extraer"; el test no puede depender de la zona horaria de la máquina. Se fija `process.env.TZ` en el propio test o se pasa la zona explícita. |
| R-U-6 | **Casos límite de fecha:** cambio de día UTC vs local, fin de mes, año bisiesto. Son los casos donde un test pasa en la máquina del autor y falla en CI. |
| R-U-7 | **Números:** probar `0`, negativos, `NaN`, `Infinity`, límites de tipo. En este repo es crítico en `normalizeJobLimits`: hay que probar que `0` cae al default y no desactiva el presupuesto, y que un valor por encima de `HARD_LIMITS` se recorta (`R-DI-4`). |

## Inputs inválidos (defensa)

| ID | Regla |
|---|---|
| R-U-8 | **Toda función que acepta `string \| null \| undefined` se testea con todos los casos de vacío:** `undefined`, `null`, `''`, `'   '`, `'undefined'`, `'null'`, string inválido, y string con espacios extremos. |
| R-U-9 | **Todo parser de entrada externa tiene un test de input malicioso o corrupto.** En este repo "entrada externa" es, sobre todo, **la salida del LLM**: JSON roto, comando inventado, `type` en minúsculas, campos de más, `maxItems` como string, URL con credenciales embebidas o con esquema raro. Es la categoría de test más importante del proyecto, porque la entrada es no confiable por definición (`R-AI-4`). |

## Controladores y lógica (dobles)

| ID | Regla |
|---|---|
| R-U-10 | **El doble no sustituye la asertación de dominio.** Que se llamó al store no basta: hay que verificar los **valores construidos** según el requisito (los límites normalizados, el estado inicial del job, el `correlationId` propagado, el `Idempotency-Key` con su ámbito). |
| R-U-11 | **Prohibido el test que solo comprueba que se llamó a un doble** (`assert(store.create.mock.calls.length === 1)` a secas). Si lo único que se comprueba es "se llamó", el test pasa aunque los argumentos sean erróneos: ese es exactamente el modo de fallo que dejó pasar el bug original. |
| R-U-12 | **Cada pieza de lógica con ramas tiene un test por rama.** Lo mínimo en este repo: el camino feliz, la precondición que falla (error), y la propagación del fallo de la dependencia (que el error del LLM o del fetch llega al job y no se traga). En la práctica esto significa que cada comando del DSL tiene un test de ejecución, cada regla del normalizador tiene un test, y cada rango bloqueado de SSRF tiene un test. |
| R-U-13 | **Los errores se asertan con su identidad completa:** mensaje/shape y causa, no solo "lanzó". En el motor y en los proveedores, que el fallo del LLM se propague y que el `JobError` guardado diga qué pasó. |
| R-U-14 | **Los guards y pipes se prueban por rama:** `ApiKeyGuard` con clave válida / inválida / ausente, y en producción sin claves; `RateLimitGuard` bajo y sobre el límite; el `ValidationPipe` que descarta campos no declarados. La defensa de la API es una línea de código y una regla (`R-SE-9`, `R-DS-4`) que solo se sostiene si el guard tiene spec. |
| R-U-15 | **Los specs no importan símbolos inexistentes ni tocan API privada de la implementación** para que el test valide comportamiento. Si hay que usar un interno para poder testearlo, es que el módulo expone demasiado: se extrae una función con nombre en vez de forzar el test. |

## Cobertura de archivos unit

| ID | Regla |
|---|---|
| R-U-16 | **100 % de los ficheros de lógica pura del repo tienen test**: el normalizador, los límites y el recorte, la validación del DSL, el cálculo de límites del job, el SSRF y los rangos de IP, la allowlist, el cifrado, los nombres de métrica, las utilidades. Son funciones puras y deterministas: no hay excusa. Esto **sustituye** a la regla heredada que pedía specs para `packages/shared/src` (esa ruta no existe aquí). |
| R-U-17 | **El bucle del agente y la planificación tienen test de sus decisiones, no de su prosa.** Un test que verifica que `planner` produce un plan válido es valioso; uno que verifica que el prompt tiene una frase concreta no lo es (ese texto cambia sin que cambie el comportamiento). |
| R-U-18 | **Todo fichero nuevo de lógica llega con su test en el mismo cambio.** Un PR que añade `packages/commands/src/<nuevo>.ts` sin su test en `tests/` no está terminado, aunque `npm test` siga en verde: está verde porque no prueba lo nuevo. |

## Verificación

```bash
# La suite entera con MongoDB simulado (lo que corre CI)
MONGODB_MOCK=1 npm test

# Un solo fichero, para iterar rápido
node --test tests/dsl.test.mjs

# Los ficheros de lógica pura y sus tests existen en paralelo
ls tests/*.test.mjs | wc -l
grep -rln "normalizeCommand\|clampCommandLimits\|normalizeJobLimits\|assertPublicUrl" packages/*/src
```
