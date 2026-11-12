# AUDIT — Estado de cumplimiento de `docs/rules/`

> **Snapshot** reescrito completo en cada auditoría (`R-COV-3`): este archivo
> describe el estado **presente** de **este repo**, medido con los comandos del
> final. El histórico de auditorías vive en
> [`AUDIT-HISTORY.md`](./AUDIT-HISTORY.md).

- **Última auditoría:** 2026-11-11 — cierre de F7–F10: arquitectura hexagonal
  conforme (`R-HX-14`), casos de uso fuera de `apps/*`, adaptadores independientes
  y verificador de fronteras ampliado a manifests y puertos.
- **Estado global:** 🟢 **ARQUITECTURA HEXAGONAL CONFORME**. Los gates funcionales
  están verdes en la ejecución local (Android/Termux); la integración con Docker y
  el E2E no se re-ejecutaron en este entorno. La puerta de seguridad queda **roja**
  por avisos nuevos de `npm audit` (deuda de mantenimiento, no de arquitectura).

## Números medidos

| Métrica | Valor | Cómo se midió |
|---|---|---|
| Tests unitarios | **281 / 281 en verde, 49 ficheros** (44 `tests/*` + 5 reglas SOLID/arquitectura) | `MONGODB_MOCK=1 npm test` |
| Ficheros de test | **47 en `tests/`**; 49 en `npm test` (excluye contrato, integración y E2E) | `ls tests/*.test.mjs` |
| Tests de contrato / integración | **13 / 7** (contrato re-ejecutado; integración histórica) | `npm run test:contract`, CI |
| Runner | **Vitest** (`vitest run --coverage`) | script `test` |
| Lint / fronteras | **0 errores, 0 warnings** · **123 imports + 19 manifests** | `npm run lint` |
| Build | **exit 0**, 17 libs + 2 apps | `npm run build` |
| Cobertura | **71.33 / 59.38 / 61.67** (líneas/ramas/funciones); umbral **65/54/56** | `npm test` (Vitest v8) |
| Puerta de seguridad | 🟡 **0 high / 12 moderate** (upstream `crawlee→minimatch`) | `npm audit --audit-level=high` ✅ |
| OpenAPI | `docs/openapi.json` sincronizada | `G-8` |
| Libs | **19** en `libs/*/*` + 2 apps | `ls -d libs/*/*` |
| Modelos Prisma | **12**; migraciones **9** | `prisma/schema.prisma` |
| Comandos del DSL | **19** literales Zod | `libs/domain/ai/src/value-objects/schemas.ts` |
| Git | rama `refactor/hx-f7-puertos-dominio`; **133 commits, 0 merges** | `git rev-list` |
| Workflows | **4** (`ci.yml`, `e2e.yml`, `release.yml`, `promote.yml`) | `.github/workflows/` |

## Estado por capa

| Capa | Estado | Evidencia |
|---|---|---|
| Unit / integración con dobles | 🟢 | **281 tests / 49 ficheros**, sin red externa ni Docker (`MONGODB_MOCK=1`) |
| Frontend | **N/A** | No hay `frontend/`; `G-2`/`R-COV-5` reservados |
| Integración con almacén real | 🟡 histórico | 7/7 en CI; no re-ejecutado en Android sin Docker |
| Contrato de API | 🟢 | `tests/contract.test.mjs` (13/13) |
| E2E real | 🟡 histórico | workflow `e2e.yml` en release; requiere Chromium + LLM |
| OpenAPI | 🟢 | `docs/openapi.json` + `openapi:check` |
| Cobertura | 🟢 | 71.33/59.38/61.67 sobre umbrales 65/54/56 |
| Property-based | 🟢 | `fast-check` + `tests/property.test.mjs` |
| Mutation testing | 🟢 provisionado | Stryker command runner; no es gate de PR |
| Lint / Build (`G-7`) | 🟢 | 0 errores / 0 warnings; build exit 0 |
| Security gate | 🟡 | **0 high**; 12 moderate heredados de `crawlee→minimatch 9` (sin fix sin degradar crawlee) |
| Documentación (`R-DO`) | 🟢 | READMEs por lib/app y plantillas de entorno al día |
| Contribución de IA (`R-AC`) | 🟢 | rama semántica, sin commit/push automático, gates ejecutados |
| Arquitectura hexagonal (`R-HX`) | 🟢 **conforme** | `R-HX-14` cerrado con evidencia local y tests de arquitectura |

## Auditoría de arquitectura hexagonal (2026-11-11)

El verificador [`check-boundaries.mjs`](../../../scripts/check-boundaries.mjs)
informa **110 imports de fuente y 19 manifests** verificados; además de la dirección
de capas, falla ante dependencias entre adaptadores y protege **18 puertos** frente a
declaraciones/re-exports en infraestructura.

| Regla / criterio | Estado | Evidencia reproducible |
|---|---|---|
| `R-HX-1`, `R-HX-6`, `R-HX-9` — topología | ✅ | `packages/` ausente; `apps/*` + 16 `libs/*/*`; nombres `@ai-scraper/<capa>-<contexto>` |
| `R-HX-2` — dirección estricta | ✅ | 123 imports y 19 manifests sin aristas prohibidas |
| `R-HX-3`, `R-HX-13` — dominio aislado | ✅ | sin `process.env`, SDKs ni I/O en `libs/domain` ni `libs/application`; política SSRF inyectada |
| `R-HX-4` — enforcement | ✅ | el script cubre imports, manifests, adaptadores y puertos; corre en `npm run lint` |
| `R-HX-5` — composición | ✅ | adaptadores y config se instancian en `main.ts`, `providers.ts` y adaptadores de `apps/*` |
| `R-HX-8` — estructura del dominio | ✅ | `entities/`, `value-objects/`, `services/` en los tres dominios |
| `R-HX-10` — apps delgadas | ✅ | controllers delegan en casos de uso; worker = bootstrap + consumer + wiring |
| `R-HX-11` — puertos del consumidor | ✅ | `JobStore`, `SessionStore`, `JobQueue`, `AICache`, `EnginePageCache`, `UserRepository`, `SiteKnowledge`, `ScraperEngine`, `SiteMemory`, `SiteCrawler`, `RadiographyProfileRepository`, etc. |
| `R-HX-12` — adaptadores independientes | ✅ | `infrastructure/mongodb` ya no importa crawler/execution; cero imports entre adaptadores |
| `R-HX-14` — cierre verificable | ✅ | (a) imports+manifests verdes; (b) puertos en application; (c) sin adaptador→adaptador; (d) apps delgadas; (e) dominio sin I/O/SDK; (f) tests de casos de uso con dobles (`job/session/site/user/scraper-use-cases`); (g) gates ejecutados |

Fases: **F7** puertos y roles de dominio; **F8** casos de uso de jobs, sesiones,
usuarios, radiografía y workflow del agente; **F9** desacople de adaptadores y borde
delgado; **F10** enforcement y cierre. Plan completo en
[`../../migracion-arquitectura.md`](../../migracion-arquitectura.md).

## Gates

| Gate | Estado | Evidencia |
|---|---|---|
| `G-1` suite unitaria | ✅ | ejecución local 2026-11-11: 281/281 |
| `G-2` unit frontend | **N/A** | sin frontend (ID reservado) |
| `G-3` cobertura | ✅ | `vitest run --coverage`; 71.33/59.38/61.67 |
| `G-4` integración | 🟡 histórico | 7/7 en CI; no re-ejecutado sin Docker |
| `G-5` contrato | ✅ | 13/13 local |
| `G-6` E2E | 🟡 histórico | `e2e.yml` (release), no re-ejecutado |
| `G-7` lint + build | ✅ | build exit 0; lint 0/0 |
| `G-8` Swagger sync | ✅ | `openapi:check` |
| Seguridad (`R-QA-6`) | 🟡 | 0 high; 12 moderate de `crawlee→minimatch` sin fix compatible |
| `G-9` deriva de migraciones | 🟡 validado | `prisma validate` ✅; migraciones nuevas sin `migrate deploy` local (sin Docker) |

**Total: 6 ✅ · 3 🟡 · 1 N/A · 1 puerta de seguridad ❌.** Evidencia histórica de CI:
run `37361504637` sobre `main`; para esta auditoría la evidencia es local
(2026-11-11) más la ejecución histórica de integración/E2E.

Controles sin ID `G-*`: puerta de seguridad (`R-QA-6`/`R-SE-16`), cliente real de la
API (`npm run test:api`) y smoke de Prisma que se autoexcluye sin `DATABASE_URL`.

## Deudas abiertas (orden de ataque)

1. **`npm audit` parcialmente mitigado (R-QA-6)**: **0 high / 12 moderate**
   (2026-11-11). Resueltos `body-parser`, `multer`, `@nestjs/platform-express`,
   `mongoose`, `zod` (4.6.7) y `minimatch` en dev tools. Los 12 moderate restantes
   vienen de `crawlee@3.18.2 → @crawlee/core → minimatch@9`; el único fix publicado
   degrada `crawlee` a 3.2.2 (breaking) y no se acepta. `npm audit --audit-level=high`
   está en verde; se revisará cuando crawlee publique un rango parcheado.
2. **Sin protección de rama en el remoto (bloqueada por el plan)**: `gh api`
   devuelve 403 en repo privado; `R-GE-4` se cumple por disciplina (rama + PR).
3. **Promoción entre entornos: configuración del operador pendiente** (`R-GE-5`,
   ADR-32): faltan environments, aprobaciones/secretos y deploy real.
4. **Mutation testing: baseline del resto del área crítica** (`R-MT-1`, ADR-31):
   `libs/domain/execution` = 92.73 %; falta DSL/SSRF. No es gate de PR.
5. **`overrides` de transitivas** (ADR-16/ADR-18): queda `deepmerge-ts`; revisar
   cuando `@prisma/config` lo empaquete >= 8.
6. **Integración/E2E no re-ejecutados en este entorno**: requieren Docker/Chromium;
   el código afectado está cubierto por unitarios y contrato. Re-ejecutar en CI.

## Cerradas en esta auditoría (2026-11-11)

- **F7 — puertos y dominio**: `AIProvider*`/`AICache` a `application/ai`;
  `EnginePageCache` a `application/execution`; `EngineMemory` a `domain/scraper`;
  roles `entities/value-objects/services` en los tres dominios; política SSRF
  inyectada (`allowPrivateHosts`) y `assertPublicUrl` sin dependencia de entorno en
  el dominio.
- **F8 — casos de uso**: jobs, sesiones, usuarios, radiografía y workflow del agente
  fuera de `apps/*`, con puertos para storage, cola, motor, memoria de sitio,
  credenciales, métricas, proveedor y crawler. `UserService` ya no instancia Prisma
  sin `DATABASE_URL`.
- **F9 — adaptadores y borde**: `infrastructure/mongodb` desacoplado de
  crawler/execution; `performRadiography` y el loop heurístico en
  `application/scraper`; composición en `apps/*`.
- **F10 — enforcement**: `check-boundaries.mjs` valida imports **y** manifests,
  prohíbe adaptador→adaptador y protege 18 puertos; `tests/architecture.test.mjs`
  añade 5 verificaciones de cierre (`R-HX-14`).
- **Cobertura**: de 66.61/55.02/57.06 (auditoría anterior) a **71.33/59.38/61.67**.
- **Tests**: de 174 a **281** (+107), con suites de casos de uso, arquitectura, webhooks y schedules.

## Historial heredado (procedencia)

- **1ª auditoría (2026-10-05)**: reescritura completa de `docs/rules/` contra la
  realidad medida (áreas nativas, `_meta` con cifras propias, ADR-16..ADR-21).
- Entradas anteriores a 2026-10-05: pertenecen a **otros proyectos** («Core Engine»,
  ZKTeco) y se conservan como procedencia; no describen este repo.

## Cómo re-auditar

```bash
# Verificación de cierre: la misma que ejecuta el job build-test-lint
npm run build && npm run lint && MONGODB_MOCK=1 npm test

# Gate de seguridad y de contrato/OpenAPI
npm audit --audit-level=high && npm audit --audit-level=moderate
npm run openapi:check
npm run test:contract

# Integración con almacenes reales (G-4)
docker compose up -d postgres mongodb redis
DATABASE_URL='postgresql://scraper:scraper@localhost:5432/scraper?schema=public' \
MONGODB_URI='mongodb://localhost:27017/scraper' REDIS_URL='redis://localhost:6379' \
  npm run test:integration

# Arquitectura (R-HX-14)
npm run boundaries:check
npx vitest run tests/architecture.test.mjs tests/*-use-cases.test.mjs

# Documentación (R-DO): READMEs que faltan y plantillas de entorno
for d in apps/* libs/*/*; do [ -f "$d/README.md" ] || echo "falta $d/README.md"; done
ls .env.example .env.production.example
grep -c "^## ADR-" docs/decisiones.md

# Estado del repo y de los workflows
git branch -a && git rev-list --count main && git rev-list --merges --count main
ls .github/workflows/

# Evidencia de CI (R-COV-3: un gate ✅ solo con run verde)
gh run list --limit 5
gh run view <id>
```

Al terminar: **reescribir este snapshot** y **agregar una entrada** al final de
`AUDIT-HISTORY.md` (`R-COV-3`).
