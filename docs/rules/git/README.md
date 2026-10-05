# Reglas de Git — AI Web Scraping Executor

Reglas que **todo** cambio versionado debe cumplir antes de llegar a `origin`:
cómo se arma el stage, cómo se narra el commit, cómo se publica y por dónde entra
el trabajo. Un historial limpio es infraestructura: los commits son la
documentación viva de por qué existe cada línea.

> ## La realidad de este repo
>
> | | Estado (verificado con `git branch -a`) |
> |---|---|
> | Ramas | **Una sola: `main`.** No hay `develop` ni `staging` |
> | Historial | **58 commits, 0 merge commits** → historia lineal, sin PRs fusionados |
> | Commits | Majoritariamente Conventional Commits (`feat(security):`, `fix(metrics):`, `test(client):`), con algunos asuntos largos descriptivos |
> | Protección | El workflow dispara en `push` a `main` **y** en `pull_request`; no se ha configurado branch protection en el remoto |
> | Estado actual | `docs/` (incluido `docs/rules/`) está **sin trackear** |
>
> El modelo de tres ramas (`develop` → `staging` → `main`) que heredarían estos
> documentos pertenece a otro proyecto. Aquí se norma **una rama** y la promoción
> entre entornos se registra como **deuda**, no como norma vigente. Ver
> [`00-entornos.md`](./00-entornos.md).

## Archivos

| Archivo | Contenido | Sufijo |
|---|---|---|
| `00-entornos.md` | Modelo de ramas real: `main` única, entorno local, promoción como deuda | `R-GE` (1–6) |
| `01-stage.md` | `git add`: stage explícito, atómico, sin artefactos ni secretos | `R-GA` (1–5) |
| `02-commits.md` | `git commit`: Conventional Commits, unidad temática, verificación previa | `R-GC` (1–7) |
| `03-push.md` | `git push`: qué subir, cuándo, force-push, divergencia, verificación posterior | `R-GP` (1–7) |
| `04-pr.md` | `gh pr`: rama por trabajo, cuerpo con evidencia, checks en la cabeza, merge | `R-PR` (1–9) |

> Los documentos derivados de este área (**CHECKLIST, AUDIT, AUDIT-HISTORY**) no
> viven aquí: están en [`../_meta/`](../_meta/README.md). Un área de reglas solo
> contiene `README.md` + archivos `NN-tema.md`.

## Mapa de IDs

| Prefijo | Rango | Archivo | Ámbito |
|---|---|---|---|
| `R-GE-*` | 1–6 | `00-entornos.md` | Ramas y entornos: `main` única, entorno local, promoción (deuda) |
| `R-GA-*` | 1–5 | `01-stage.md` | Stage (`git add`) |
| `R-GC-*` | 1–7 | `02-commits.md` | Commit (`git commit -m`) |
| `R-GP-*` | 1–7 | `03-push.md` | Push (`git push`) |
| `R-PR-*` | 1–9 | `04-pr.md` | PR (`gh pr`): rama, cuerpo, checks, merge |

## Principio rector

> **Un push es una declaración profesional.** Antes de que un commit llegue a
> `origin` debe poder resumirse en una frase (R-GC-3), haberse armado con stage
> explícito (R-GA-1) y pasar la verificación de su ámbito (R-GC-5). Lo que no se
> puede resumir en una frase, no se sube.
>
> **Y una rama es una unidad revisable**, aunque hoy el repositorio trabaje con una
> sola: todo cambio que no sea un fix inmediato de `main` viaja en una rama con su
> PR y su evidencia (R-PR-4), y llega con los checks verdes **en la cabeza del PR**,
> no en una base anterior (R-PR-6).
>
> **Y `main` es lo que se despliega.** Nada se escribe a mano en `main` (R-GE-4):
> si algo debe llegar allí, llega por un PR con el job `build-test-lint` en verde.

## Convenciones (mantener el "punto fijo")

1. **Formato de ID:** `R-<SUFIXO>-<n>` secuencial e incremental dentro del archivo.
   Un sufijo pertenece a **un solo archivo** (GE, GA, GC, GP, PR). Nunca renumerar ni
   reutilizar IDs existentes.
2. **Formato de regla:** tabla `| ID | Regla |`; redacción en imperativo, concreta
   y verificable en un PR (si no se puede comprobar, no es una regla).
3. **Archivos:** numeración `NN-tema.md` con título `# NN — Tema`. Un archivo nuevo
   = un sufijo nuevo.
4. **Referencias cruzadas:** siempre con el ID completo (`R-GC-5`), jamás "la regla 5".
   Antes de renombrar o eliminar una regla, `grep -rn "R-GA-\|R-GC-\|R-GP-\|R-PR-" docs/rules/`
   para actualizar todas las referencias (incluye `../_meta/`).
5. **Agregar una regla nueva:** añadirla en su archivo → actualizar el **Mapa de IDs**
   de este README → reflejarla en [`../_meta/CHECKLIST.md`](../_meta/CHECKLIST.md)
   → re-auditar (`R-COV-3`).
6. **Estado ≠ regla:** las reglas son permanentes; el cumplimiento vive en
   [`../_meta/AUDIT.md`](../_meta/AUDIT.md) (snapshot) y
   [`../_meta/AUDIT-HISTORY.md`](../_meta/AUDIT-HISTORY.md) (log).

## Cómo verificar (comandos)

```bash
# stage revisado: solo los archivos del cambio
git status --short && git diff --cached --stat

# qué se va a subir exactamente (debe coincidir con lo previsto)
git log origin/main..HEAD --oneline

# asuntos de commit conformes a Conventional Commits (imprime los que no lo son)
git log origin/main..HEAD --pretty=%s \
  | grep -vE '^(feat|fix|docs|test|refactor|perf|style|ci|build|chore|ops)(\([a-z0-9/-]+\))?: .+'

# verificación del ámbito antes de commitear: la de este repo
npm run build && npm run lint && MONGODB_MOCK=1 npm test

# historia lineal: debe imprimir 0
git rev-list --merges --count origin/main

# checks verdes en la CABEZA del PR (R-PR-6) y verificación posterior (R-PR-8)
gh pr checks <n>
gh run list --branch main --limit 3 --json headSha,conclusion,status

# qué está sin trackear ahora mismo
git status --short
```
