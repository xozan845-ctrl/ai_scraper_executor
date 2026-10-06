# Reglas de CI — AI Web Scraping Executor

Mecánica de la integración continua: qué se ejecuta, con qué versión, con qué
dependencias y con qué evidencia. **Los gates de calidad (`G-1`…`G-9`) no viven
aquí**: son reglas de testing y siguen en
[`../test/06-estandares-cobertura.md`](../test/06-estandares-cobertura.md).

> ## La realidad: `ci.yml` (2 jobs) + `e2e.yml` + `release.yml`
>
> ```yaml
> # ci.yml — push a main, pull_request y workflow_dispatch (forzar a mano)
> concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }
> jobs.build-test-lint:
>   services: postgres:16-alpine (schema/deriva + contrato + unit)
>   npm ci --ignore-scripts → npm audit --audit-level=high → prisma generate
>   prisma validate → migrate deploy → migrate diff --exit-code
>   build → openapi:check → lint → test → contract
>   artifact: test-results.xml (if: always())
> jobs.integration:
>   services: postgres + mongodb + redis
>   migrate deploy → build → test:integration
>
> # e2e.yml — release / workflow_dispatch (no en PR)
>   services: postgres + mongodb + redis · Chromium · OPENROUTER_API_KEY
>   migrate deploy → build → test:e2e
>
> # release.yml — push de tag v*.*.* / workflow_dispatch (dry_run por defecto)
>   valida tag + procedencia (en main y con run de ci verde) → build de las 2 imágenes
>   GHCR con etiquetas OCI; publica solo si no es dry_run (R-CD-1..8)
> ```
>
> No hay `security-gate` como job separado (el audit es un paso del job), ni jobs de
> lint/test/build separados. Las reglas de este archivo **norman** ese workflow; donde
> describen algo que no existe, lo marcan como deuda en vez de fingir que corre.

## Archivos

| Archivo | Contenido | IDs |
|---|---|---|
| `01-flujos.md` | Gatillos, concurrencia, sin `paths`, pipeline único, revisión de `.github/`, verificación con `gh` | `R-CI` (1–6) |
| `02-entorno.md` | Versión de Node, instalación, servicios efímeros, evidencia, secretos y navegadores | `R-EN` (1–5) |

> El **despliegue** no vive en esta área: vive en [`../cd/`](../cd/README.md).
> CI integra; CD despliega. Los derivados (AUDIT, CHECKLIST, historiales) están en
> [`../_meta/`](../_meta/README.md).

## Mapa de IDs

| Prefijo | Rango | Archivo | Ámbito |
|---|---|---|---|
| `R-CI-*` | 1–6 | `01-flujos.md` | Flujos, ejecución y verificación de CI |
| `R-EN-*` | 1–5 | `02-entorno.md` | Entorno, servicios y evidencia en CI |

## Reglas de otras áreas que CI debe exigir (cross-refs)

| ID | Exigencia en CI | ¿Hoy? |
|---|---|---|
| `G-1` | Suite unitaria completa en verde | ✅ paso `Test` |
| `G-7` | Build y lint sin errores | ✅ pasos `Build` y `Lint` |
| `G-9` | Migraciones sin deriva | ✅ `prisma validate` + `prisma migrate deploy` + `prisma migrate diff --exit-code` sobre un Postgres efímero |
| `G-3` | Cobertura ≥ umbral | ✅ el propio `npm test` (nativo de Node; 70/72/67) |
| `G-4` | Integración con BD real | ✅ job `integration` (Postgres/Mongo/Redis efímeros) |
| `G-5` | Contrato de API | ✅ paso `Contract` (`npm run test:contract`) |
| `G-6` | E2E antes de release | ✅ workflow `e2e.yml` (`release`/`workflow_dispatch`) |
| `G-8` | Swagger sincronizado | ✅ `npm run openapi:check` sobre `docs/openapi.json` (paso `OpenAPI spec in sync`) |
| `R-QA-6` | `npm audit --audit-level=high` bloqueante | ✅ paso `Security audit` (0 vulnerabilidades, high y moderate) |
| `R-FL-1` | Tests intermitentes: detección por repetición | ✅ herramienta `npm run test:repeat` (a propósito **no** es gate de PR: es lenta) |
| `R-COV-3` | Un gate ✅ solo con run verde de CI | sí, es el criterio de esta área |
| `R-GP-2/6` | Push con checks verdes; rojo ⇒ fix-forward | sí, con `gh` (R-CI-6) |

## GitHub CLI (`gh`) — por qué importa

`gh` es la **única forma verificable desde terminal** de ver el estado real de la CI
(R-CI-6). Sin él, cerrar el ciclo *push → run verde* depende de abrir el navegador
o de suponer que "el anterior estaba verde", que es justo lo que las reglas prohíben.

| Comando | Cuándo y qué aporta |
|---|---|
| `gh run list --limit 5` | ¿El push ya corrió?, ¿verde o rojo?, edad del run |
| `gh run view <id>` | Pasos concretos del job: cuál se rompió + anotaciones del runner |
| `gh run watch <id>` | Seguir en vivo un run en curso (no sirve si ya terminó) |
| `gh run view <id> --log-failed` | Log del paso fallido → punto de partida del fix-forward (R-GP-3) |
| `gh pr checks <n>` | Checks en la **cabeza** del PR (R-PR-6) |
| `gh auth status` / `gh auth login` | Estado / autenticación (una vez por máquina) |

La importancia es cerrar la evidencia: un cambio terminado es un commit con
`completed success` en **su** run (R-CI-6). Todo lo demás es opinión.

## Pendientes (deuda recogida aquí)

- **Puerta de seguridad ya en CI (deuda cerrada)**: la puerta de `R-QA-6` /
  `R-SE-16` **ya es un paso** (`Security audit`) y reporta **0 vulnerabilidades**
  (high y moderate). Ver [`../_meta/AUDIT.md`](../_meta/AUDIT.md).
- **Concurrencia y servicios efímeros (deuda cerrada)**: `R-CI-2` declara
  `concurrency` con `cancel-in-progress`; `R-EN-2` usa un servicio
  `postgres:16-alpine` en `build-test-lint` (schema/deriva) y **`postgres` +
  `mongodb` + `redis`** en el job `integration` (`G-4`).
- **Artifacts (deuda cerrada)**: `R-EN-3` sube `test-results.xml` (reporter JUnit de
  Node) como artifact en todos los runs (`if: always()`). Sirve de evidencia de la
  suite sin depender del log del job.
- **Sin protección de rama (bloqueada por el plan)**: no puede configurarse en un repo
  privado sin GitHub Pro (`403 Upgrade to GitHub Pro …`). El workflow escucha
  `pull_request`; el enforcement de `R-GE-4` es por disciplina, no de GitHub. Ver
  [`../git/00-entornos.md`](../git/00-entornos.md).
- **El evento `pull_request` no siempre se entrega (peculiaridad del remoto)**: en tres
  PRs seguidos (el #1 entregó `opened`; los #2/#3 no), abrir o actualizar el PR no
  disparó el run hasta **cerrar y reabrir**. Verificado: Actions está habilitado
  (`enabled:true`, `allowed_actions:all`) y el mismo `ci.yml` corre sin problema en
  `push` a `main` y en el PR tras reabrir, así que **no es configuración del repo**.
  Mitigación: el gatillo manual `workflow_dispatch`
  (`gh workflow run ci.yml --ref <rama>`), aceptado en `R-CI-1`.
