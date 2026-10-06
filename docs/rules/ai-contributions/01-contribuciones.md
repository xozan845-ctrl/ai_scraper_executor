# 01 — Contribuciones de IA

Reglas para los agentes de IA que proponen o aplican cambios en este repositorio. El
objetivo: que no diluyan, ignoren ni rompan el punto fijo de [`docs/rules/`](../README.md).
La IA amplifica el trabajo; no debe amplificar la entropía.

## Reglas

| ID | Regla |
|---|---|
| R-AC-1 | **Lectura de contexto obligatoria**: antes de proponer o aplicar un cambio, el agente lee [`../README.md`](../README.md) (índice y convenciones), las áreas que va a tocar y [`../_meta/AUDIT.md`](../_meta/AUDIT.md) (deudas abiertas y estado de los gates). No se modifica una regla sin citar explícitamente la que se modifica (`R-COV-3`). |
| R-AC-2 | **Herramientas nativas, sin atajos**: el agente usa las herramientas del entorno (lectura, edición, búsqueda) y respeta las instrucciones del harness que lo ejecuta; prohibido fabricar scripts que editen el repositorio por detrás de esas herramientas. Las convenciones de colaboración del harness viven en `AGENTS.md`; esta área solo norma el **proceso de cambio**, no el tooling. |
| R-AC-3 | **Git estricto y commits atómicos**: el agente se somete al mismo estándar que un humano ([`../git/`](../git/README.md)): stage explícito (`R-GA-1`), un commit por unidad temática (`R-GC-3`), Conventional Commits en español y con el ID de regla cuando aplique (`R-GC-1`, `R-GC-4`). Prohibido el commit «arreglé varias cosas». |
| R-AC-4 | **Sin pases libres ante los gates**: todo cambio del agente pasa por los gates vigentes (`G-1..G-9`, [`../test/06-estandares-cobertura.md`](../test/06-estandares-cobertura.md)) y sus tests asertan el requisito (`R0`, `R-U-1`), nunca la implementación. La cobertura no baja (`R-COV-1`). Si añade logs, son JSON estructurado (`R-OB-1`). |
| R-AC-5 | **La entrega es un PR, nunca `main`**: el agente no commitea ni empuja a `main` (`R-GE-4`, `R-PR-1`). Trabaja en una rama semántica y entrega por PR con el [`CHECKLIST`](../_meta/CHECKLIST.md) cumplimentado y tablas de evidencia reales (comandos ejecutados y su salida), no «los tests pasan» (`R-PR-4`). |
| R-AC-6 | **Refactors consensuados**: si el agente detecta una mejora estructural ajena a la tarea, la registra como deuda (en [`../_meta/AUDIT.md`](../_meta/AUDIT.md) o en el «Pendientes» del área) en vez de aplicarla. Prohibido el refactor silencioso u oportunista que ensucia el PR (`R-GC-3`). |

## Verificación

```bash
# La rama del agente es un delta atómico (R-AC-3)
git log origin/main..HEAD --oneline

# Ningún trabajo directo sobre main (R-AC-5)
git branch --show-current   # no debe imprimir 'main'

# La verificación de cierre que exige el gate G-7 (R-AC-4)
npm run build && npm run lint && MONGODB_MOCK=1 npm test
```
