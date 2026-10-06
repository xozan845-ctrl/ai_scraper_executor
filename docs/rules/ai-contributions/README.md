# Reglas para Contribuciones de IA — AI Web Scraping Executor

Reglas que **cualquier agente de IA** (o humano asistido) debe cumplir al proponer
cambios en este repositorio. No son reglas del producto —el LLM que planifica el
scraping vive en [`../ai/`](../ai/README.md)— sino reglas de **proceso** para que una
IA no diluya el punto fijo. Una IA es un amplificador; un amplificador no debe
amplificar entropía.

> **No confundir con [`../ai/`](../ai/README.md) (sufijo `R-AI`)**: aquello es el DSL
> que el modelo del producto emite; esto es cómo colabora la IA que toca el
> repositorio. El sufijo `R-AC` es deliberadamente distinto de `R-AI`; el anagrama
> `R-IA` **no se usa** para no crear referencias cruzadas erróneas.

## Archivos

| Archivo | Contenido | Sufijo |
|---|---|---|
| `01-contribuciones.md` | Lectura de contexto, herramientas, commits atómicos, gates, PR como entregable, no refactors oportunistas | `R-AC` (1–6) |

> Los documentos derivados de este área (**AUDIT, CHECKLIST, historiales**) no viven
> aquí: están en [`../_meta/`](../_meta/README.md). Un área de reglas solo contiene
> `README.md` + archivos `NN-tema.md`.

## Mapa de IDs

| Prefijo | Rango | Archivo | Ámbito |
|---|---|---|---|
| `R-AC-*` | 1–6 | `01-contribuciones.md` | Cómo colabora un agente de IA en este repo |

## Reglas de otras áreas que exige esta (cross-refs)

| ID | Exigencia |
|---|---|
| `R-AC-1` | Leer el índice y el snapshot de estado antes de tocar nada → [`../README.md`](../README.md), [`../_meta/AUDIT.md`](../_meta/AUDIT.md) |
| `R-AC-3` | Commits atómicos y Conventional Commits → `R-GC-1..7` (`../git/02-commits.md`) |
| `R-AC-4` | Los gates vigentes y el principio `R0` → `G-1..G-9` (`../test/06-estandares-cobertura.md`), `R-U-1` (`../test/01-reglas-unit.md`), `R-COV-1` (`../test/06-estandares-cobertura.md`) |
| `R-AC-5` | Rama + PR, nunca `main` → `R-GE-4` (`../git/00-entornos.md`), `R-PR-1..9` (`../git/04-pr.md`) |

## Pendientes

- Esta área nació el 2026-10-06 a partir de un borrador escrito para otro proyecto
  («Core Engine»). Se adaptó a este repo: sin `microservicios`, sin IDs retirados
  (`R-GW`), con los gates reales (`G-1..G-9`) y con el flujo de una sola rama
  (`main` + PR).
