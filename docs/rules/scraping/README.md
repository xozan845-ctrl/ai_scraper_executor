# Reglas del Motor de Scraping

Reglas de **cómo** se ejecuta lo que la IA decidió: qué transporte se usa para cada
página, cómo se respeta el presupuesto de un job, cuándo se reintenta, cómo se cancela
y qué se guarda junto a cada item extraído.

> Este proyecto **no** es un perfilador de usuario final: es un motor. El producto es
> "extrae lo que esta web tiene, de forma trazable y sin que la IA pueda pasarse".
> Casi todas las reglas de esta área se derivan de esa última parte.

## Archivos

| Archivo | Contenido | Sufijo |
|---|---|---|
| `01-motor.md` | Transporte HTTP/browser, presupuestos, deduplicación, `PageCache`, browser pool, recovery, reintentos, cancelación | `R-SC` (1–9) |
| `02-trazabilidad.md` | Trazabilidad `_source`, persistencia de resultados, radiografía y perfiles aprendidos | `R-SC` (10–16) |

> Los documentos derivados de este área (**AUDIT, CHECKLIST, historiales**) no viven
> aquí: están en [`../_meta/`](../_meta/README.md). Un área de reglas solo contiene
> `README.md` + archivos `NN-tema.md`.

## Mapa de IDs

| Prefijo | Rango | Archivo | Ámbito |
|---|---|---|---|
| `R-SC-*` | 1–9 | `01-motor.md` | Transporte, presupuestos, reintentos y cancelación |
| `R-SC-*` | 10–16 | `02-trazabilidad.md` | Qué se guarda con cada resultado y de dónde salió |

## Reglas de otras áreas que exige esta (cross-refs)

| ID | Exigencia |
|---|---|
| `R-SC-1` | HTTP antes que browser → el presupuesto de `maxRequests` es lo que lo sostiene: `R-SC-3` (este archivo) |
| `R-SC-2` | El recorte de límites se aplica en el motor → `R-AI-7` (`../ai/01-dsl.md`) |
| `R-SC-6` | La caché con TTL no es la verdad → `R-DI-5` (`../data/01-integridad.md`) |
| `R-SC-8` | La cola de muertos y sus reintentos → `R-AR-8` (`../architecture/01-arquitectura.md`) |
| `R-SC-9` | El recovery no inventa: sigue el mismo DSL → `R-AI-3` (`../ai/01-dsl.md`) |
| `R-SC-11` | `_source` es trazabilidad de datos → `R-DI-1` (`../data/01-integridad.md`) |
| `R-SC-14` | La radiografía escribe en MongoDB → `R-MO-2` (`../db/02-mongodb.md`) |

## Pendientes

- La recuperación automática está limitada a **2 intentos** por job (valor por
  defecto). Subirlo es un cambio de coste y de latencia: pasa por ADR (`R-AR-9`).
- El `PageCache` es por defecto de 100 entradas con TTL de 5 min
  (`PAGE_CACHE_MAX_ENTRIES`, `PAGE_CACHE_TTL_MS`). Con jobs grandes el hit rate cae;
  no se sube sin medir (→ `R-TM-4`).
