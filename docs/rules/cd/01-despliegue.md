# 01 — Release por tag e imágenes (`R-CD-1..8`)

Reglas del pipeline de **artefactos de release** (tags, imágenes, migraciones,
secretos). Conservan su número heredado.

> **Estado hoy: no existe `release.yml`.** No hay tags de release, ni publicación
> de imágenes a ningún registry, ni promoción automática. La entrega actual es
> *build desde el commit de `main`*: `docker compose up -d --build` construye las
> dos imágenes desde el `Dockerfile` de cada app y las ejecuta. Estas reglas son
> el **contrato exigible** el día que exista un pipeline de release (R-CI-4), no la
> descripción de algo que ya corre. Lo que sí se norma hoy —orden de arranque,
> migraciones, secretos, smoke y rollback— está en
> [`02-entornos.md`](./02-entornos.md) (`R-CD-9..12`).

| ID | Regla |
|---|---|
| R-CD-1 | **Versionado inmutable por tag**: una release se dispara exclusivamente al hacer `push` de un tag `v<major>.<minor>.<patch>`, con sufijo prerelease opcional (`-alpha.1`, `-rc.2`); el patrón se valida antes de construir y un tag inválido aborta el run. Nunca desde una rama, nunca reconstruyendo `main`. Un tag publicado no se mueve ni se borra: un error se corrige con un tag nuevo, igual que una release publicada no se reescribe. La `version` del `package.json` es hoy `0.1.0` y privada: el día del primer tag, el tag y esa versión se mueven a la vez. |
| R-CD-2 | **Procedencia verificada antes de publicar**: el commit etiquetado tiene que estar en `main` (`git merge-base --is-ancestor <sha> main`) y tener al menos un run de `ci.yml` con `conclusion == success` en **ese mismo SHA**; si no hay ninguno, el run aborta y lista los runs que sí hubo para el diagnóstico. R-GP-6 ya prohíbe dar por bueno el verde de otro commit; aquí es condición de publicación, no una recomendación. `workflow_dispatch` sirve para repetir el proceso de un tag existente, nunca para publicar código sin CI verde. |
| R-CD-3 | **Construir una vez, promover por digest**: las imágenes se construyen una sola vez y de ahí en adelante se promueve por `@sha256:`, sin reconstruirlas. Un digest es inmutable y un tag de Docker es una etiqueta móvil: promover por tag rompe la reproducibilidad en cuanto algo vuelve a publicarse con el mismo nombre. Si hay que reconstruir, es otro tag y otro digest. **Hoy el `compose` reconstruye** (`build:` con `context: .`), así que dos `up --build` del mismo commit no producen el mismo digest: por eso `R-CD-3` no es cumplible hasta que exista el pipeline de imágenes, y por eso la reversión de hoy es "volver al commit anterior" (R-CD-12) y no "redesplegar un digest". |
| R-CD-4 | **Trazabilidad**: cada imagen lleva etiquetas OCI con el origen (`org.opencontainers.image.revision` = SHA del commit, `source` = URL del repo) y se nombra con versión semver (`1.2.3`, `1.2`, `1`), `sha-<corto>` para identificar el commit sin depender de semver, y `latest` **solo** en releases no-prerelease. `latest` nunca apunta a una alpha ni a una rc. El digest de lo publicado queda en el resumen del run (`$GITHUB_STEP_SUMMARY`). |
| R-CD-5 | **Migraciones solo hacia adelante**: desplegar aplica el esquema **solo desde las migraciones versionadas en `prisma/migrations/`**, y solo con `migrate deploy` (R-DB-3), nunca una mutación ad-hoc de esquema ni `migrate dev` (que además está explícitamente vetado en el `compose`). El rollback de una release es **volver al commit anterior**, nunca revertir el historial de migraciones: deshacer migraciones ya aplicadas en producción significa perder datos, y ninguna reversión de SQL es segura por defecto. Una migración no reversible se documenta como tal en su commit y su plan de reversión es el commit anterior (R-CD-12). |
| R-CD-6 | **Producción exige una puerta**: el despliegue de producción solo puede dispararse desde `main` (R-GE-4), nunca desde otra rama ni desde un webhook suelto. Si algún día se desarrolla un pipeline propio, va contra un `environment` con revisores obligatorios, y ningún runner self-hosted recibe secretos de producción. Publicar un artefacto es reversible; ejecutar migraciones sobre datos reales no lo es. |
| R-CD-7 | **Cero secretos en la imagen**: ninguna credencial entra como `ARG` ni como `ENV` de construcción, y ninguna queda en una capa. Los Dockerfiles actuales de `api` y `worker` no declaran ningún `ARG` ni `ENV` con credencial — solo `WORKDIR`, `EXPOSE`, `HEALTHCHECK` y, en el worker, `DEBIAN_FRONTEND`; los secretos llegan en tiempo de ejecución por `env_file` y `environment` del `compose` (R-CD-11). Un secreto en una capa es un secreto público para quien pueda descargar la imagen, y las capas no se borran: se añaden. |
| R-CD-8 | **Simulacro por defecto**: `workflow_dispatch` trae `dry_run: true` como valor por defecto, así que una ejecución manual construye las imágenes, las descarta y no publica nada. Publicar exige un tag, o bien `dry_run: false` explícito en la ejecución manual. Es la diferencia entre probar el proceso y cambiar el estado del mundo. |

## Verificación

```bash
# el workflow de release no existe (R-CD-1..8 pendientes)
ls .github/workflows/

# las imágenes de la entrega actual: dos, una por app
grep -n "^FROM\|ARG\|EXPOSE\|HEALTHCHECK\|CMD" apps/api/Dockerfile apps/worker/Dockerfile

# procedencia: el commit de la entrega está en main
git rev-parse HEAD && git merge-base --is-ancestor HEAD main && echo ok

# migraciones: solo hacia adelante, versionadas
ls prisma/migrations
npx prisma migrate status --schema=prisma/schema.prisma
```
