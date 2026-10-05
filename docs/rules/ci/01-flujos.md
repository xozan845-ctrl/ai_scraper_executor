# 01 — Flujos de CI (gatillos y ejecución)

Aplica a: cuándo y cómo se ejecuta `.github/workflows/ci.yml`. El archivo tiene hoy
**un job** (`build-test-lint`); las reglas describen cómo debe comportarse ese job y
marcan como deuda lo que aún no está configurado.

| ID | Regla |
|---|---|
| R-CI-1 | **Gatillos**: la CI corre en **todo push a `main`** y en **todo `pull_request`** (sin filtro de ramas destino, tal como está el `on:` actual). Consecuencia: un push a una rama con PR abierto **también** dispara la vía `pull_request` (y el de `push` solo si la rama es `main`), así que una rama de trabajo con PR genera un run por push. Los gatillos cubren la única rama del repo (`R-GE-1`): todo lo que llega a `main` pasó por CI. Añadir una segunda rama de integración o cambiar el reparto de gatillos exige enmienda explícita de esta regla. |
| R-CI-2 | **Concurrencia**: cada workflow declara un grupo por ref con `cancel-in-progress: true` — un push nuevo cancela el run anterior de la misma rama; prohibido apilar runs obsoletos. `ci.yml` lo declara a nivel de workflow: `group: ${{ github.workflow }}-${{ github.ref }}` con `cancel-in-progress: true`. Quitarlo o relajarlo para "no cancelar en main" exige enmienda explícita de esta regla. |
| R-CI-3 | **Sin filtros `paths`**: todo evento de push o PR ejecuta la CI completa, aunque el cambio sea solo de documentación (decisión deliberada: nada pasa desapercibido; con una sola rama y un job de segundos, el filtrado no compra nada). Introducir filtrado = enmienda de esta regla, nunca una optimización silenciosa. |
| R-CI-4 | **Pipeline único de integración**: `.github/workflows/ci.yml` es el único workflow que corre en push/PR. Existe un segundo workflow aceptado y documentado aquí: [`e2e.yml`](../../../.github/workflows/e2e.yml), que **no** corre en PR — se dispara en `release`/`workflow_dispatch` y ejecuta el E2E real (`G-6`), porque necesita servicios reales, Chromium y el secret `OPENROUTER_API_KEY`. Un tercer workflow solo se acepta con un caso de uso que ninguno de los dos cubra, documentado aquí **antes** de existir. |
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
