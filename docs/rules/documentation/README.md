# Reglas de Documentación — AI Web Scraping Executor

Reglas de la documentación técnica del proyecto: READMEs, comentarios y JSDoc, ADRs,
plantillas de entorno y la spec de la API. La documentación se trata como **código**:
tiene convenciones, se revisa en PRs y se mantiene sincronizada con la implementación
real.

## Archivos

| Archivo | Contenido | Sufijo |
|---|---|---|
| `01-reglas-documentacion.md` | READMEs por paquete/app, sincronización del root, plantillas de entorno, comentarios y JSDoc, ADRs, OpenAPI, `_meta`, sincronización README ⇄ código | `R-DO` (1–8) |

> Los documentos derivados de este área (**AUDIT, CHECKLIST, historiales**) no viven
> aquí: están en [`../_meta/`](../_meta/README.md). Un área de reglas solo contiene
> `README.md` + archivos `NN-tema.md`.

## Mapa de IDs

| Prefijo | Rango | Archivo | Ámbito |
|---|---|---|---|
| `R-DO-*` | 1–8 | `01-reglas-documentacion.md` | Documentación técnica y de negocio |

## Reglas de otras áreas que exige esta (cross-refs)

| ID | Exigencia |
|---|---|
| `R-DO-3` | Las plantillas de entorno no llevan secretos → `R-SE-17` (`../security/02-acceso.md`), `R-DS-1` (`../data/02-seguridad.md`) |
| `R-DO-4` | El porqué, no el qué → `AGENTS.md` (estilo) y `R-NC-*` (`../architecture/02-naming.md`) |
| `R-DO-5` | Toda decisión estructural es un ADR → `R-AR-9` (`../architecture/01-arquitectura.md`), `docs/decisiones.md` |
| `R-DO-6` | La spec OpenAPI versionada es el contrato → `R-C-2`/`R-C-12` (`../test/04-reglas-contrato.md`), `G-8` |
| `R-DO-7` | Lo derivado vive en `_meta/` → [`../_meta/README.md`](../_meta/README.md) |
| `R-DO-8` | La sincronización README ⇄ código se revisa en cada PR → [`../_meta/CHECKLIST.md`](../_meta/CHECKLIST.md) (sección 13), `R-PR-4` (`../git/04-pr.md`) |

## Estado

- **`README.md` por paquete/app (R-DO-1): cumplido** desde 2026-10-06. Los 12 packages
  de `packages/*` y las 2 apps de `apps/*` tienen su README (responsabilidad,
  dependencias, superficie pública y comandos). Antes era deuda registrada en
  [`../_meta/AUDIT.md`](../_meta/AUDIT.md).
