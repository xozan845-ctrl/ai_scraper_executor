# 02 — Entorno y evidencia en CI

Aplica a: versión de runtime, instalación de dependencias, servicios de base de
datos y la evidencia que deja cada ejecución. El comando que CI ejecuta es, casi
literalmente, el mismo que hay que ejecutar en local.

| ID | Regla |
|---|---|
| R-EN-1 | **Entorno reproducible y single-source**: versión de Node **fija en el workflow** (hoy el literal `"22"`, que coincide con la imagen base de los Dockerfiles `node:22-alpine` / `node:22-bookworm-slim`) y con `cache: npm`. La instalación es **exclusivamente** `npm ci --ignore-scripts`: el `package-lock.json` es la fuente de verdad y `npm install` libre está prohibido en CI. Dos matices: `--ignore-scripts` es obligatorio porque los `postinstall` de Playwright/Crawlee no deben correr en el instalador de CI (Chromium se instala aparte, `R-EN-5`); y `--legacy-peer-deps` **ya no se usa** — se retiró al subir Nest 12 y eslint 10, que alinearon los peers (ADR-18). Volver a añadir la bandera es una enmienda explícita de esta regla, no una optimización silenciosa. Las GitHub Actions se fijan a un **major soportado por el runner** (`actions/checkout@v7`, `actions/setup-node@v7` y `actions/upload-artifact@v7`, todas sobre Node 24); cuando GitHub declare un runtime deprecado, se sube el major en un cambio de `.github/` revisado como código (`R-CI-5`). |
| R-EN-2 | **Servicios efímeros por job, nunca infraestructura compartida**: el job `build-test-lint` levanta un servicio **`postgres:16-alpine`** (mismos credenciales/healthcheck que `docker-compose.yml`) para validar el esquema y detectar deriva de migraciones (`G-9`): `prisma migrate deploy` aplica `prisma/migrations/` sobre esa BD y `prisma migrate diff --exit-code` falla si el schema diverge. El job **`integration`** (`G-4`) levanta además `mongo:7-jammy` y `redis:7-alpine` con los mismos tags y healthcheck, y apunta `DATABASE_URL`/`MONGODB_URI`/`REDIS_URL` únicamente a esos servicios del job. Cada servicio es de un solo job y se descarta al terminar; CI jamás toca la BD de desarrollo. La suite unitaria sigue sin BD real (corre con `MONGODB_MOCK: '1'`, `R-QA-2`). **Aplicar un esquema sin historial está prohibido en CI**: no deja rastro reproducible ni auditable. |
| R-EN-3 | **Evidencia en todos los runs**: un job que genera reportes los sube como artifact en **todos** los runs (`if: always()`), verde o rojo: es la evidencia de auditoría (R-COV-3). Hoy `build-test-lint` sube `test-results.xml` (reporter JUnit de Node, generado por `npm test`). El estado del gate lo determina el resultado del job, nunca la presencia del artifact ni su contenido. |
| R-EN-4 | **Secretos**: viven únicamente en GitHub Secrets; prohibido imprimirlos en logs (`echo`, `set -x` sobre un env de credenciales) y
prohibido versionarlos — esta regla extiende R-GA-4 a CI. Ningún paso persiste credenciales entre pasos ni entre jobs, y `build-test-lint`/`integration` **no necesitan ninguno** (sus suites son autocontenidas). El E2E de release (`e2e.yml`, `G-6`) es el único que inyecta `OPENROUTER_API_KEY`, y solo en su job, nunca en `build-test-lint`. |
| R-EN-5 | **La instalación de navegadores no se cuela en el job unitario**: Chromium/Playwright se instala en el `Dockerfile` del worker (`npx playwright install --with-deps chromium`) para el despliegue, y en el host del desarrollador para el E2E local. El job `build-test-lint` **no** lo instala: la suite unitaria dobla el navegador, y añadirlo duplicaría el tiempo de CI por una dependencia que no usa (`R-FL-4`). |

## Verificación

```bash
# las tres versiones de Node que deben coincidir (R-EN-1)
grep -n "node-version" .github/workflows/ci.yml      # 22
grep -n "^FROM" apps/api/Dockerfile apps/worker/Dockerfile
node -v                                                  # engines: >=20

# la instalación exacta de CI
grep -n "npm ci" .github/workflows/ci.yml

# que la suite no necesita secretos: el único env del job
grep -n -A2 "env:" .github/workflows/ci.yml            # MONGODB_MOCK: '1'

# el servicio efímero de Postgres que CI usa para validar schema/deriva (R-EN-2)
grep -n "image: postgres\|services:" .github/workflows/ci.yml
grep -n "image: postgres\|image: mongo\|image: redis" docker-compose.yml

# schema válido y sin deriva (G-9)
npx prisma validate --schema=prisma/schema.prisma
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
```
