# 02 — Commit: `git commit -m`

## Reglas

| ID | Regla |
|---|---|
| R-GC-1 | Mensaje en Conventional Commits: `<tipo>(<ámbito>): <resumen en imperativo, español>`. Tipos admitidos: `feat, fix, docs, test, refactor, perf, style, ci, build, chore, ops`; ámbitos reales del cambio, que son los de este repo: `api`, `worker`, `security`, `engine`, `limits`, `metrics`, `redis`, `ai`, `auth`, `crawler`, `persistence`, `client`, `scripts`, `rules`, `ci`, `docs`. Ejemplo: `fix(limits): topes duros de servidor y validacion anidada`. |
| R-GC-2 | El asunto dice QUÉ cambia y POR QUÉ importa, en una sola línea; prohibidos `wip`, `fix`, `update`, `changes`, `add stuff` y cualquier mensaje que solo repita el nombre del archivo tocado. |
| R-GC-3 | Un commit = una unidad temática que puede resumirse en una frase; prohibido mezclar feature + fix + formato + dependencias en el mismo commit. |
| R-GC-4 | Si el cambio implementa, corrige o verifica una regla, citar su ID completo al final del asunto o en el cuerpo (`(R-DI-3)`); si el cambio viene de una deuda de auditoría, citar el ítem correspondiente. Un cambio de seguridad que toca el SSRF, la autenticación o las credenciales cita su regla aunque no haya un test nuevo (`R-SE-*`). |
| R-GC-5 | Dejar en verde la verificación de su ámbito ANTES de commitear. En este repo el conjunto es: `npm run build && npm run lint && MONGODB_MOCK=1 npm test` (los tres, porque el build es lo que hace resolubles los `paths` de los paquetes y `MONGODB_MOCK=1` es lo que permite correr la suite sin Docker). Un paquete concreto se puede acotar con `npm run build -w @ai-scraper/<lib>` y `npx vitest run tests/<fichero>.test.mjs`, pero el cierre antes de pushear es siempre el conjunto. Commitear roto está prohibido: el código roto se arregla o se queda fuera del commit. |
| R-GC-6 | Cuando el asunto no alcanza a explicar el porqué, usar el cuerpo del commit: bug (síntoma + causa), refactor (motivo), cambio rompente (cómo migrar). Formato: `git commit -m "asunto" -m "cuerpo"`. |
| R-GC-7 | No reescribir commits ya publicados: `--amend` o rebase solo sobre commits locales que NUNCA subieron a `origin`; sobre `origin` las correcciones van como commit nuevo. |

## Verificación

```bash
# asuntos conformes a Conventional Commits (imprime los que NO lo son)
git log origin/main..HEAD --pretty=%s \
  | grep -vE '^(feat|fix|docs|test|refactor|perf|style|ci|build|chore|ops)(\([a-z0-9/-]+\))?: .+'

# unidad temática: qué toca el commit
git show --stat HEAD

# la verificación de cierre de este repo
npm run build && npm run lint && MONGODB_MOCK=1 npm test
```
