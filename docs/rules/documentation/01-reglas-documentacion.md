# 01 — Reglas de Documentación

La documentación es el activo que sobrevive a las migraciones y refactorizaciones. Se
trata como código: tiene convenciones, se revisa en PRs y debe mantenerse sincronizada
con la implementación real.

## Reglas

| ID | Regla |
|---|---|
| R-DO-1 | **README por paquete y por app**: cada paquete de `packages/*` y cada app de `apps/*` DEBE tener un `README.md` que describa su responsabilidad, sus dependencias exclusivas, su superficie pública (comandos del DSL, stores, endpoints, adaptadores) y los comandos para construirla/ejecutarla. Un paquete nuevo sin README no está terminado. La ausencia de uno es **deuda registrada** en [`../_meta/AUDIT.md`](../_meta/AUDIT.md), no una excepción silenciosa. |
| R-DO-2 | **El root README es la única fuente de verdad de la topología**: [`../../../README.md`](../../../README.md) documenta las 5 capas, los servicios, los puertos, las variables comunes y los pasos de despliegue; ningún cambio de puerto, servicio expuesto o ruta pública se mergea sin actualizarlo. La topología que **manda** es la que declaran `docker-compose.yml` y los Dockerfiles; el README la describe, no la inventa. |
| R-DO-3 | **Plantillas de entorno versionadas**: toda variable de entorno nueva o eliminada del código se refleja en `.env.example` (valores de desarrollo) y, cuando exista, en la plantilla de producción con marcadores (`.env.production.example`). Las plantillas son documentación viva de la configuración y **jamás** contienen un secreto real (`R-SE-17`, `R-DS-1`); `.env` y `.env.local` están en `.gitignore` **y** `.dockerignore`. |
| R-DO-4 | **El porqué, no el qué**: los comentarios explican *por qué* se hace algo (una restricción no obvia, una decisión, una trampa), no *qué* hace la línea siguiente. Las interfaces públicas y los casos de uso documentan parámetros, salida y errores esperados (JSDoc). No se comenta lo evidente: la norma de estilo del repo es «sin comentarios salvo que aporten contexto no obvio» (`AGENTS.md`). |
| R-DO-5 | **Toda decisión estructural es un ADR**: añadir una herramienta (`fast-check`, Playwright), cambiar el esquema de datos, el orden de build o apartarse de un patrón se registra como **ADR** en [`../../decisiones.md`](../../decisiones.md), con contexto, opciones y decisión. Una decisión sin ADR es una decisión que se pierde (→ `R-AR-9`). |
| R-DO-6 | **La spec OpenAPI es el contrato y está versionada**: todo cambio en request/response DTOs va con sus decoradores (`@ApiProperty`) **y** con `docs/openapi.json` re-exportado en el mismo cambio; `npm run openapi:check` (paso `OpenAPI spec in sync`, `G-8`) falla si la spec diverge de la API (`R-C-2`, `R-C-12`). |
| R-DO-7 | **Lo derivado vive en `_meta/`**: los hallazgos de auditoría, los checklists y los snapshots de estado van en [`../_meta/`](../_meta/README.md); prohibido incrustar snapshots transitorios o resultados de CI en los READMEs estructurales o en un área de reglas. |
| R-DO-8 | **Todo cambio de lógica sincroniza el README de su módulo en el mismo PR**: una implementación o modificación de comportamiento en `packages/*` o `apps/*` se entrega con el `README.md` del módulo tocado actualizado si cambia algo que éste documenta (responsabilidad, superficie pública, comandos, dependencias, recuento de tests); si el cambio **no** altera nada documentado, el PR lo declara explícitamente en el [`CHECKLIST`](../_meta/CHECKLIST.md). Lo que el README dice y lo que el código hace no pueden divergir: la documentación desfasada es un defecto del cambio, no deuda aceptable. Generaliza las obligaciones específicas de `R-DO-1` (crear el README), `R-DO-2` (topología), `R-DO-3` (entorno) y `R-DO-6` (contrato), que siguen vigentes con su alcance. |

## Verificación

```bash
# READMEs de paquete/app que faltan (R-DO-1)
for d in apps/* packages/*; do [ -f "$d/README.md" ] || echo "falta $d/README.md"; done

# Plantillas de entorno al día (R-DO-3)
ls .env.example .env.production.example
# En PRODUCCIÓN, toda variable sensible o usa un marcador <...> o va vacía (no un valor real)
grep -E '^(API_KEYS|FIRST_RUN_TOKEN|CREDENTIALS_KEY|OPENROUTER_API_KEY|AI_CUSTOM_API_KEY|DATABASE_URL|MONGODB_URI|REDIS_URL|POSTGRES_PASSWORD)=' .env.production.example | grep -vE '=.*<[^>]+>|=$' || true

# Toda decisión estructural es un ADR (R-DO-5)
grep -c "^## ADR-" docs/decisiones.md

# La spec de la API está en sync (R-DO-6)
npm run openapi:check

# Nada derivado fuera de _meta (R-DO-7): debe imprimir vacío
git ls-files 'docs/rules/*/AUDIT*' 'docs/rules/*/CHECKLIST*'

# Módulos tocados en el PR (R-DO-8): cada uno debe traer su README en el diff del
# PR o la excepción declarada en el CHECKLIST del PR
git diff --name-only origin/main...HEAD | grep -E '^(apps|packages)/' | cut -d/ -f1-2 | sort -u
```
