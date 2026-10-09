# 05 — Reglas de Robustez y Calidad

Reglas transversales que suben la calidad más allá del camino feliz. En un proyecto
cuya entrada principal es **una salida de un modelo de lenguaje**, la robustez de
entradas no es un extra: es la función.

## Regression-first (la regla que motivó este documento)

| ID | Regla |
|---|---|
| R-REG-1 | **Todo bug confirmado**: primero el test que **falla** con el bug (rojo), luego la fix (verde). El PR del fix no se acepta sin ese test, y el test se marca como `regression: <ref>`. |
| R-REG-2 | El test de regresión aserta el **requisito correcto**, no "el cambio que hicimos" (ver `R0`). |
| R-REG-3 | Después de un bug de una capa, se evalúa si faltaba una capa superior (integración/E2E) que lo hubiera detectado antes; si sí, se añade al menos un test en esa capa. |

## Property-based testing

| ID | Regla |
|---|---|
| R-PB-1 | Las **funciones puras de transformación** se someten a property tests: invariantes verificados con muchos inputs generados, no con tres casos fijos. La herramienta es **`fast-check`** y las propiedades viven en [`tests/property.test.mjs`](../../../tests/property.test.mjs), dentro de `npm test`. Candidatas cubiertas: `normalizeJobLimits` (recorte de presupuestos), `normalizeRawCommand`/`normalizeRawPlan` (DSL) y `normalizeDomain`/`isAllowedHost` (allowlist). |
| R-PB-2 | **Propiedades mínimas de los presupuestos**: para cualquier entrada (válida o no), `normalizeJobLimits` devuelve un entero en `[1, HARD_LIMITS[key]]`; un valor no finito o `<= 0` cae al default; `0` nunca desactiva un presupuesto (`R-DI-4`). Y para el recorte de comandos: el límite efectivo de un comando nunca supera el del job (`R-AI-7`). **Esta propiedad encontró un defecto real**: un positivo menor que 1 (`5e-324`) hacía `floor` a 0 y se salía de `[1, HARD]`; se corrigió con `Math.max(1, …)`. |
| R-PB-3 | **Propiedades mínimas del normalizador**: normalizar un comando ya normalizado es idempotente; un comando inventado se descarta (no se "arregla"); **el `type` resultante siempre pertenece al DSL** y campos ausentes toman los defaults sin cambiar el `type`. **Estas propiedades encontraron un defecto real**: claves como `__proto__`/`constructor` (o `_ proto _`) resolvían contra el prototipo del mapa de alias y se colaban como comando; se corrigió con `Object.hasOwn` (`R-SE-*` de robustez de entrada). También destaparon que `normalizeDomain` **no era idempotente** (dejaba un espacio: `'; /'` → `'; '` → `';'`); se corrigió añadiendo `.trim()` a la forma canónica. |

## Mutation testing

| ID | Regla |
|---|---|
| R-MT-1 | Los **módulos críticos** (el DSL y su validación, el SSRF, la normalización de límites, la trazabilidad) se someten a mutation testing con periodicidad pre-release. **Implementado (ADR-31):** **Stryker** (`@stryker-mutator/core` + runner de Vitest), config en `stryker.config.mjs`, script **`npm run test:mutation`**. Muta el **JS de `dist`** (lo que importan los tests) del área crítica (`libs/domain/*`, `libs/shared/core`, `libs/shared/security`). **No es un gate de PR** (es lento); su evidencia es la ejecución manual pre-release. |
| R-MT-2 | **Rangos de mutantes eliminados**: ≥ 90 % para el DSL/SSRF/límites (la frontera de seguridad), ≥ 80 % para el resto, y por debajo de **70 %** el release queda bloqueado. Mutantes supervivientes → tests débiles a corregir antes del release. Estos umbrales aplican **el día que la herramienta exista**; hoy no se pueden evaluar (`R-COV-4`) porque la herramienta está diferida (`R-MT-1`, ADR-20). |
| R-MT-3 | Un test que no mata ningún mutante se mejora o se elimina (equivale a un test que no comprueba el requisito). |

## Robustez de entradas

| ID | Regla |
|---|---|
| R-RB-1 | **Fuzz mínimo de la salida del LLM** (la entrada más no confiable del sistema): JSON malformado, `type` en minúsculas o inventado, campos de más, números como strings, `maxItems` negativo o enorme, URL con esquema raro, un array de acciones vacío o con `null` dentro. Cada uno debe terminar en "plan inválido" o "normalizado", nunca en una excepción sin capturar. |
| R-RB-2 | **Límites de tamaño y de ritmo**: probar `limits` en sus extremos (0, negativos, valores por encima de `HARD_LIMITS`, `maxAiTokens: 0` que no desactiva) y listados con `limit` enorme (debe recortarse al máximo del servidor). Un límite que solo se prueba en el valor happy no está probado. |
| R-RB-3 | **Reintento y solape**: relanzar un job (`POST /api/v1/jobs/:id/retry`) limpia los artefactos previos y no duplica resultados (`R-SC-13`); dos jobs simultáneos sobre el mismo sitio no se pisan (cada uno tiene su estado y su contexto). Y ante fallo parcial del crawler, no quedan resultados a medias sin sello de origen. |
| R-RB-4 | **Caída de una dependencia**: si MongoDB cae, el job degrada y termina (`R-MO-5`); si Redis cae, caché y rate limit degradan a memoria avisando (`R-RD-5`); si el LLM cae, el circuit breaker abre y el job termina en estado terminal, **no colgado** (`R-AI-14`). Ninguna de estas tres deja el job en un limbo. |

## Anti-flakiness

| ID | Regla |
|---|---|
| R-FL-1 | **Cero tolerancia a tests intermitentes.** Un test que falla 1 de cada 20 corre en CI: se arregla o se marca en cuarentena con issue y fecha máxima de reparación. La herramienta de detección es **`npm run test:repeat -- <n>`** ([`scripts/repeat-tests.mjs`](../../../scripts/repeat-tests.mjs)), que repite la suite `n` veces (por defecto 5) y falla si alguna iteración queda en rojo mientras otras están en verde. **No es un gate de PR** (es lento, ~25 s por iteración): se ejecuta antes de un release o al investigar un fallo esporádico. |
| R-FL-2 | **Prohibido el `sleep` arbitrario** para esperar una condición; usar esperas activas sobre la condición real (el job llegó a estado terminal, el endpoint responde) con su propio timeout. |
| R-FL-3 | **Sin dependencia del orden entre tests** ni de la zona horaria/máquina. `vitest` ejecuta los ficheros de un directorio; cada test prepara lo que necesita y no asume estado previo. |
| R-FL-4 | **Sin dependencia de red externa ni de terceros** en la suite unitaria (`npm test`): `fetch`, el LLM y los sitios se doblan. La única capa que habla con la red real es el E2E (`03-reglas-e2e.md`), y por eso va en otro comando. |
| R-FL-5 | **La suite unitaria es serial (`fileParallelism: false`), y esa es la decisión**: Crawlee usa almacenamiento local en disco; ejecutar tests en paralelo lo corrompe y produce fallos intermitentes no reproducibles. Mientras Crawlee tenga ese almacenamiento, la concurrencia se queda en 1; parallelizar exige primero aislar ese storage (deuda abierta de esta regla). |

## Verificación

```bash
# La suite es serial a propósito (R-FL-5)
grep -n "fileParallelism" vitest.config.mjs

# Property tests (R-PB-*): corren dentro de npm test
npx vitest run tests/property.test.mjs

# El fuzz de la salida del LLM tiene casos (R-RB-1)
grep -rn "inventado\|malformado\|desvi" tests/normalize.test.mjs tests/dsl.test.mjs | head

# Los extremos de límites tienen casos (R-RB-2)
grep -n "0\|negativ\|NaN\|Infinity" tests/limits.test.mjs | head
```
