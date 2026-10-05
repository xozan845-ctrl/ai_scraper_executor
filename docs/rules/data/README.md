# Reglas de Data — AI Web Scraping Executor

Reglas doradas sobre los **datos** como activo: integridad (máquina de estados del
job, idempotencia, trazabilidad, límites, caché que no es verdad) y seguridad
(secretos, credenciales cifradas, PII, dependencias).

> ¿Esquemas, migraciones, índices y el detalle de cada almacén? Van en
> [`../db/`](../db/README.md). Este área trata la **lógica de los datos**, no el
> almacenamiento.

> **Sustituye** a las reglas heredadas de dinero/stock/partida doble: el activo de
> datos de este proyecto es el **resultado de scraping, con su origen y su coste**, no
> una cifra contable.

## Archivos

| Archivo | Contenido | Sufijo |
|---|---|---|
| `01-integridad.md` | Estados de `JobStatus`, idempotencia de jobs y de LLM, trazabilidad, límites y presupuestos, caché ≠ verdad, coherencia entre almacenes | `R-DI` (1–8) |
| `02-seguridad.md` | Secretos, credenciales cifradas, contraseñas y API keys hasheadas, PII y sanitizado, dependencias | `R-DS` (1–7) |

> Los documentos derivados de este área (**AUDIT, CHECKLIST, historiales**) no viven
> aquí: están en [`../_meta/`](../_meta/README.md). Un área de reglas solo contiene
> `README.md` + archivos `NN-tema.md`.

## Mapa de IDs

| Prefijo | Rango | Archivo | Ámbito |
|---|---|---|---|
| `R-DI-*` | 1–8 | `01-integridad.md` | Integridad y consistencia de los datos |
| `R-DS-*` | 1–7 | `02-seguridad.md` | Seguridad de los datos y de las dependencias |

## Reglas de otras áreas que exige esta (cross-refs)

| ID | Exigencia |
|---|---|
| `R-DI-1` | La trazabilidad se inyecta en el motor → `R-SC-10` (`../scraping/02-trazabilidad.md`) |
| `R-DI-2` | La idempotencia de la API respalda la limpieza de artefactos → `R-SC-13` (`../scraping/02-trazabilidad.md`) |
| `R-DI-4` | El presupuesto de tokens corta el job → `R-AI-12` (`../ai/02-modelos.md`) |
| `R-DI-5` | Caché con TTL ≠ verdad → `R-AR-6` (`../architecture/01-arquitectura.md`) y `R-RD-3` (`../db/03-redis.md`) |
| `R-DI-6` | El fallback en memoria avisa por log → `R-AR-6` (`../architecture/01-arquitectura.md`) |
| `R-DS-3` | Nada cifrado sale por la API → `R-SE-11` (`../security/02-acceso.md`) |
| `R-DS-7` | El gate de dependencias vive en CI → `R-QA-6` (`../test/07-qa-gates.md`) |

## Pendientes

- No hay retención declarada para `Page`, `Command` ni `AIInteraction`: la tabla crece
  con cada job. Definirla es un cambio normativo pendiente (`R-DI-8`).
- `Result.data` y `AIInteraction.request/response` son `Json`: el esquema de lo que
  guarda la IA no está versionado en el repo. Un cambio de prompt puede cambiar esa
  forma sin que nada lo detecte (`R-DI-7`).
