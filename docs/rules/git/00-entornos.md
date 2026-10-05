# 00 — Ramas y entornos

Fija el modelo de ramas de este repositorio: una sola rama (`main`), un entorno de
trabajo local con Docker, y una promoción entre entornos que hoy **no existe** y se
registra como deuda.

> ## Realidad (verificada con `git branch -a`)
>
> ```
> * main
>   remotes/origin/HEAD -> origin/main
>   remotes/origin/main
> ```
>
> **Una rama.** 58 commits, **0 merge commits**: historia lineal. El workflow
> `ci.yml` dispara en `push` a `main` y en `pull_request`, así que el gate existe
> para PRs aunque hoy gran parte del trabajo se haya subido directamente.

| Entorno | Dónde corre | Rama | Uso |
|---|---|---|---|
| Desarrollo | **local** (`docker compose up -d postgres mongodb redis` + `npm run dev:api` / `dev:worker`) | rama de trabajo → PR a `main` | único entorno de trabajo; también el de la suite unitaria (con `MONGODB_MOCK=1` y sin Docker) |
| Producción | el que despliegue cada composición (ver [`../cd/`](../cd/README.md)) | `main` | lo que se ejecuta; solo avanza por merge verificado (R-GE-4) |

Los entornos heredados (`develop`, `staging`, Dockploy con tres *environments*) no
existen aquí. Se conservan los conceptos de *etapa* y *promoción* como **deuda** en
`R-GE-5` y `R-GE-6`, con la regla de que una deuda no se ejecuta como si fuera norma.

## Reglas

| ID | Regla |
|---|---|
| R-GE-1 | **`main` es la única rama y es la de integración**: no se crean ramas de largo plazo (`develop`, `staging`, `release/*`) sin una enmienda explícita a esta regla. El trabajo diario vive en una rama corta por cambio (R-PR-1) y llega a `main` por PR con el job `build-test-lint` verde (R-PR-6). `main` no se empuja directamente (R-GE-4) ni se reescribe (R-GP-3). |
| R-GE-2 | **El trabajo nace de `main` actualizado**: `git fetch origin && git pull --rebase origin main` antes de crear la rama, de modo que la rama de trabajo contenga el estado real de `main` y su PR sea un delta limpio, sin conflictos de sincronización (mismo criterio que R-GP-5). |
| R-GE-3 | **Cada cambio llega con evidencia**: el PR incluye la salida de la verificación realmente ejecutada (`npm run build && npm run lint && MONGODB_MOCK=1 npm test`) y, tras el merge, se comprueba el run del **nuevo** SHA de `main` (R-PR-8). Si el cambio toca una capa sin suite (integración, contrato, E2E), el PR lo dice explícitamente y nombra el comando manual con el que se comprobó (`npm run test:api:fast`, `npm run test:e2e`) — recordar que esas capas **no** son gates hoy (`G-4`, `G-5`, `G-6`). |
| R-GE-4 | **`main` no se escribe a mano**: ni push directo, ni merge desde consola, ni `git commit` en ella. Todo lo que llega a `main` llega por un PR verificado (R-PR-6) con historia lineal (R-PR-7). Si hace falta una corrección urgente, sigue siendo un PR (R-GE-6). |
| R-GE-5 | **Promoción entre entornos = deuda, no norma.** El modelo de promover entre `staging` y producción **no está implementado** en este repo: no hay rama de stage, ni job de despliegue por entorno, ni smoke por entorno. La regla vigente es la más simple y exigible: `main` es lo que se despliega, y quien despliega verifica con su propio smoke (`/api/v1/health/ready`, `npm run test:api:fast`). Cuando exista promoción de verdad, se define aquí con sus IDs nuevos y con su job de CI; hasta entonces no se ejecuta un ritual de `staging` inexistente. |
| R-GE-6 | **Un fix urgente es un PR corto, no una excepción al proceso**: rama `hotfix/<descripción>` desde `main`, PR a `main` con el fix, su test de regresión (R-REG-1) y la evidencia; tras el merge, verificación del run de `main` y smoke del entorno. Se permite saltarse la revisión *humana* en el tiempo de la incidencia, nunca los checks automáticos: si el job está rojo, no se despliega (R-PR-6). |

## Verificación

```bash
# una sola rama, historia lineal
git branch -a
git rev-list --merges --count main        # 0

# el worktree está limpio y no hay artefactos sin trackear
git status --short

# qué está sin trackear ahora (docs/ lo está, por diseño hasta que se versione)
git status --short --untracked-files=all | head
```

> Nota sobre `.gitignore`: cubre `node_modules/`, `dist/`, `*.log`, `.env`,
> `.env.local`, `postgres-data/`, `redis-data/`, `crawlee-storage/`, `/storage/` y
> `test-results.xml`. Un artefacto que aparezca como untracked es porque el patrón
> falta, no porque el artefacto deba versionarse (`R-GA-4`).

> **Protección de rama (R-GE-4): bloqueada por el plan.** El intento de aplicarla
> con `gh api -X PUT …/branches/main/protection` devuelve
> `403 Upgrade to GitHub Pro or make this repository public`. Es una función
> **de pago en repos privados**: no es deuda de este repo, es un límite externo.
> Para cerrarla hay dos caminos: activar GitHub Pro, o hacer el repo público. Hasta
> entonces, `R-GE-4` se cumple **por disciplina** (rama + PR + merge, no push directo)
> y no por enforcement. Ver [`../_meta/AUDIT.md`](../_meta/AUDIT.md).
