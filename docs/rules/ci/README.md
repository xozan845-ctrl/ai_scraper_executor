# Reglas de CI — AI Web Scraping Executor

Mecánica de la integración continua: qué se ejecuta, con qué versión, con qué
dependencias y con qué evidencia. **Los gates de calidad (`G-1`…`G-9`) no viven
aquí**: son reglas de testing y siguen en
[`../test/06-estandares-cobertura.md`](../test/06-estandares-cobertura.md).

> ## La realidad: un workflow, un job
>
> `.github/workflows/ci.yml` tiene **un solo job**, `build-test-lint`:
>
> ```yaml
> on: { push: { branches: [main] }, pull_request: }
> concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }
> jobs.build-test-lint:
>   ubuntu-latest · node 22 · cache npm
>   services: postgres:16-alpine (solo para validar schema y deriva)
>   npm ci --ignore-scripts
>   npm audit --audit-level=high
>   npm run prisma:generate
>   npx prisma validate
>   npx prisma migrate deploy → npx prisma migrate diff --exit-code
>   npm run build → npm run openapi:check → npm run lint → npm test
>   env: MONGODB_MOCK: '1'
>   artifact: test-results.xml (if: always())
> ```
>
> No hay `security-gate`, ni jobs de lint/test/build separados, ni artifacts, ni caché
> de `~/.cache` aparte de la de npm. Las reglas de este archivo **norman** ese
> workflow; donde describen algo que no existe, lo marcan como deuda en vez de
> fingir que corre.

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
| `G-4` | Integración con BD real | ⏸ sin servicios ni suite |
| `G-5` | Contrato de API | ⏸ sin suite |
| `G-6` | E2E antes de release | ⏸ sin job |
| `G-8` | Swagger sincronizado | ✅ `npm run openapi:check` sobre `docs/openapi.json` (paso `OpenAPI spec in sync`) |
| `R-QA-6` | `npm audit --audit-level=high` bloqueante | ✅ paso `Security audit` (0 vulnerabilidades, high y moderate) |
| `R-FL-1` | Tests intermitentes en cuarentena con fecha | ⏸ no hay herramienta que los detecte |
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
- **Concurrencia y servicios efímeros (deuda cerrada)**: `R-CI-2` ya declara
  `concurrency` con `cancel-in-progress`, y `R-EN-2` ya usa un servicio
  `postgres:16-alpine` para validar el schema y detectar deriva de migraciones
  (`G-9`). El día que exista suite de integración (`G-4`), ese mismo servicio se
  ampliará a `mongo:7-jammy` y `redis:7-alpine`.
- **Artifacts (deuda cerrada)**: `R-EN-3` ya sube `test-results.xml` (reporter JUnit de
  Node) como artifact en todos los runs (`if: always()`). Sirve de evidencia de la
  suite sin depender del log del job.
- **Sin protección de rama configurada en el remoto**: el workflow dispara en
  `pull_request`, pero nada impide un push directo a `main` mientras no se configure
  branch protection. `R-GE-4` lo norma; el enforcement es de GitHub, no del repo.
