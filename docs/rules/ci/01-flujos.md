# 01 — Flujos de CI (gatillos y ejecución)

Aplica a: cuándo y cómo se ejecutan `.github/workflows/ci.yml` (jobs
`build-test-lint` e `integration`) y el workflow de release `.github/workflows/e2e.yml`.
Las reglas describen cómo deben comportarse y marcan como deuda lo que aún no está
configurado.

| ID | Regla |
|---|---|
| R-CI-1 | **Gatillos**: la CI corre en **todo push a `main`** y en **todo `pull_request`** (sin filtro de ramas destino). Consecuencia: un push a una rama con PR abierto **también** dispara la vía `pull_request` (y el de `push` solo si la rama es `main`), así que una rama de trabajo con PR genera un run por push. Además admite un gatillo **manual** (`workflow_dispatch`) para forzar el run de una rama cuando el evento de PR no se entregó (ver el «Pendiente» de [`README.md`](./README.md)): no sustituye a `pull_request`, es una válvula de escape operativa. Los gatillos cubren la única rama del repo (`R-GE-1`): todo lo que llega a `main` pasó por CI. Añadir una segunda rama de integración o cambiar el reparto de gatillos exige enmienda explícita de esta regla. |
| R-CI-2 | **Concurrencia**: cada workflow declara un grupo por ref con `cancel-in-progress: true` — un push nuevo cancela el run anterior de la misma rama; prohibido apilar runs obsoletos. `ci.yml` lo declara a nivel de workflow: `group: ${{ github.workflow }}-${{ github.ref }}` con `cancel-in-progress: true`. Quitarlo o relajarlo para "no cancelar en main" exige enmienda explícita de esta regla. |
| R-CI-3 | **Sin filtros `paths`**: todo evento de push o PR ejecuta la CI completa, aunque el cambio sea solo de documentación (decisión deliberada: nada pasa desapercibido; con una sola rama y un job de segundos, el filtrado no compra nada). Introducir filtrado = enmienda de esta regla, nunca una optimización silenciosa. |
| R-CI-4 | **Pipeline único de integración, y workflows de entrega aparte**: `.github/workflows/ci.yml` es el único workflow que corre en push/PR. Hay **dos** workflows adicionales aceptados y documentados aquí: [`e2e.yml`](../../../.github/workflows/e2e.yml), que **no** corre en PR — se dispara en `release`/`workflow_dispatch` y ejecuta el E2E real (`G-6`), porque necesita servicios reales, Chromium y el secret `OPENROUTER_API_KEY`; y [`release.yml`](../../../.github/workflows/release.yml), que se dispara en el **push de un tag** `v*.*.*` o a mano (`dry_run` por defecto) y construye/publica las imágenes (`R-CD-1..8`). Un cuarto workflow solo se acepta con un caso de uso que ninguno de los tres cubra, documentado aquí **antes** de existir. |
| R-CI-5 | **Los cambios en `.github/workflows/**` se revisan como código**: stage con rutas explícitas (R-GA-1), sin secretos (R-GA-4), comandos **idénticos a los verificables en local** (lo que el job hace debe poder ejecutarse en la máquina), y el mensaje de commit cita las reglas tocadas (R-GC-4). Un workflow que solo se puede verificar viendo su run en GitHub no es revisable. |
| R-CI-6 | **Verificación con GitHub CLI (`gh`)**: tras cada push, el resultado se comprueba en local con `gh run list --limit 5` y `gh run view <id>`; mientras corre, `gh run watch <id>`; si falla, `gh run view <id> --log-failed`. Un trabajo no se da por terminado hasta ver `completed success` en el run **de su commit** — el verde de un run anterior no vale nada para el actual (R-GP-6, R-PR-6). Run en rojo ⇒ fix-forward con un commit nuevo que cite el fallo (R-GP-3); nunca se deja `main` en rojo sin diagnosticar. Requiere `gh auth login` una vez por máquina. |

## Verificación

```bash
# el workflow y su gatillo real
cat .github/workflows/ci.yml
gh workflow list

# el run de mi commit, y su detalle
gh run list --limit 5
gh run view <id>
gh run view <id> --log-failed

# grupo de concurrencia declarado (R-CI-2)
grep -n -A1 "concurrency" .github/workflows/ci.yml

# sin filtros paths (R-CI-3)
grep -n "paths" .github/workflows/ci.yml
```
