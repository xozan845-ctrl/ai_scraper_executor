# Reglas de IA — AI Web Scraping Executor

Reglas del **cerebro**: el DSL cerrado que el modelo puede emitir, la validación
estricta que lo acompaña, la defensa frente a modelos que se desvían, y la gestión
del proveedor de LLM (modelo, fallback, caché, presupuesto de tokens, circuito
abierto).

> Este área sustituye a la heredada `microservice/`: aquí no hay microservicios que
> estructurar, el dominio propio del proyecto es el razonamiento y su frontera de
> seguridad. Los sufijos `R-MS`/`R-MI` quedan **retirados** (ver el índice raíz).

## Archivos

| Archivo | Contenido | Sufijo |
|---|---|---|
| `01-dsl.md` | El DSL cerrado: 15 comandos, Zod estricto, normalizador, validación SSRF/allowlist, presupuestos anti-escalada | `R-AI` (1–8) |
| `02-modelos.md` | Proveedor, selección y fallback de modelos, prompts, caché LLM, presupuesto de tokens, circuit breaker | `R-AI` (9–16) |

> Los documentos derivados de este área (**AUDIT, CHECKLIST, historiales**) no viven
> aquí: están en [`../_meta/`](../_meta/README.md). Un área de reglas solo contiene
> `README.md` + archivos `NN-tema.md`.

## Mapa de IDs

| Prefijo | Rango | Archivo | Ámbito |
|---|---|---|---|
| `R-AI-*` | 1–8 | `01-dsl.md` | Qué puede emitir la IA y cómo se valida |
| `R-AI-*` | 9–16 | `02-modelos.md` | Proveedor, modelos, prompts, caché y presupuesto |

## Los 15 comandos del DSL

Fuente única: [`../../../libs/domain/ai/src/schemas.ts`](../../../libs/domain/ai/src/schemas.ts).

```
NAVIGATE · EXTRACT · EXTRACT_LIST · FOLLOW_LINKS · PAGINATE · SCROLL · CLICK · TYPE
WAIT · FINISH · AUTHENTICATE · GET_ATTRIBUTE · INSPECT_PAGE · INSPECT_LINKS
INSPECT_ELEMENTS
```

Si se añade un comando, se añade **su schema Zod**, su normalizador si el modelo
tiende a desviarse (`R-AI-4`) y su test. Un comando sin schema no existe.

## Reglas de otras áreas que exige esta (cross-refs)

| ID | Exigencia |
|---|---|
| `R-AI-1` | La IA no ejecuta código → es el corolario de `R-AR-1` (`../architecture/01-arquitectura.md`) |
| `R-AI-6` | Toda URL del DSL se valida con `@ai-scraper/shared-security` → `R-SE-1` (`../security/01-ssrf.md`) |
| `R-AI-7` | El recorte de límites también lo aplica el motor, no solo el planner → `R-SC-2` (`../scraping/01-motor.md`) |
| `R-AI-12` | El presupuesto de tokens corta el job → `R-DI-4` (`../data/01-integridad.md`) |
| `R-AI-14` | La caché de respuestas LLM no es la verdad → `R-DI-5` (`../data/01-integridad.md`) y `R-RD-3` (`../db/03-redis.md`) |
| `R-AI-16` | Un 429 del proveedor cae en el circuit breaker → `R-SC-8` (`../scraping/01-motor.md`) |

## Estado

- **Completitud del DSL cubierta**: `tests/dsl-completeness.test.mjs` (dentro de
  `npm test`) comprueba que los 15 `type` del enum Zod tienen trato en el normalizador
  y aparecen en el `DSL_SPEC` de los prompts (`R-AI-2`, `R-U-12`). Antes era deuda.

## Pendientes

- El reparto de modelos depende de IDs `:free` de OpenRouter que **roten**. La regla
  `R-AI-11` obliga a no fijarlos en el código y a tener siempre `openrouter/free` o
  una lista de fallback; el estado real de los modelos hoy está en
  [`../_meta/AUDIT.md`](../_meta/AUDIT.md).
