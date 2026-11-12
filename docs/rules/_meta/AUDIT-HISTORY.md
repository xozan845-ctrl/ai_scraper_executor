# AUDIT-HISTORY — Histórico de auditorías

> Log **cronológico append-only** de todas las auditorías (R-COV-3). El estado
> actual consolidado vive en [`AUDIT.md`](./AUDIT.md); este archivo nunca se
> reescribe: solo se le **agrega** una entrada nueva al final, por auditoría.

## ⚠️ Procedencia: lo que hay aquí abajo no auditó este repo

Este archivo se heredó de **dos proyectos ajenos** y conserva sus entradas **sin
modificar**, como procedencia documental. Sus cifras (tests, suites, workspaces,
coberturas, jobs, PRs) **no describen `ai_scraper_executor`** y no deben citarse
como estado:

| Bloque | Fechas | Pertenecen a | Qué son |
|---|---|---|---|
| Todo lo anterior a la entrada del 2026-10-01 (11 entradas: «post-Fase A/B/C», G-6/G-8, R-ES-18, ratchet de frontend, flujo de PR) | 2026-09-25 → 2026-09-30 | **ZKTeco Attendance** (Angular + Nest, microservicios, Supabase) | auditorías de un sistema de control de asistencia |
| Las tres entradas de «Core Engine» (1ª, 2ª y 3ª auditoría) | 2026-10-01 → 2026-10-03 | **«Core Engine»** (e-commerce: órdenes, comisiones, logística, Dockploy) | auditorías de otro proyecto, del que también viene el árbol de reglas |

La entrada de este repo es la **última** (abajo del todo) y es la única que mide este
código: 143 tests, 36 suites, 12 paquetes, un job de CI, una rama.

Quien necesite el estado vigente: [`AUDIT.md`](./AUDIT.md). Quien necesite saber de
dónde vino el método (IDs estables, snapshot + histórico, gates con estado
✅/⏸/N/A): el formato de estas entradas, que se conserva.

---

# AUDIT (histórico) — Auditoría de Testing vs `rules/test/`

- **Fecha:** 2026-09-25
- **Comando:** `cd backend && npm run test:cov`, `npm run test:e2e`, inspección de `ci.yml`, conteo de specs.
- **Estado global:** ❌ **NO CUMPLE** — 4 de 11 gates de CI existentes/passantes; 0 de 4 capas de test completas.

## Resumen ejecutivo

| Capa | Estado | Evidencia |
|---|---|---|
| Unit backend | 🟢 parcial | 74 suites / **308 tests en verde**, pero cobertura **38.8% líneas** (mín. 80%) |
| Unit frontend | 🟡 | 17 specs; **sin gate en CI**; karma bloqueado localmente (`.angular/cache` de root) |
| Integración (API+BD) | 🔴 | **0 tests**; sin `supertest`; solo `test/app.e2e-spec.ts` (bootstrap) |
| E2E (frontend→API→BD) | 🔴 | Suite backend **ROTA** (`jest-e2e.json` contiene JS, no JSON → `JSONError`); smoke de frontend vive en `/tmp` (no versionado) |
| Contrato (API spec) | 🔴 | **0 tests**; sin schemas de respuesta |
| Robustez (property/mutation) | 🔴 | Sin `fast-check`, sin `stryker`; `TZ` no fijada en setup de tests |

## Métricas medidas

| Métrica | Valor actual | Mínimo (R-COV/tabla) | Cumple |
|---|---|---|---|
| Backend lines | **38.8%** (1189/3063) | 80% | ❌ |
| Backend functions | **42.4%** (428/1010) | 80% | ❌ |
| Backend branches | **41.2%** (480/1164) | 70% | ❌ |
| Archivos `domain/` sin spec | **81 de 95 (85%)** | 0 (R-U-17) | ❌ |
| Tests integración | **0** | ≥1/endpoint crítico (R-I-1) | ❌ |
| Tests contrato | **0** | ≥1 por shape (R-C-10) | ❌ |
| Tests E2E flujos críticos | **0 en repo** | 7 flujos (R-E-1..7) | ❌ |
| Unit tests backend verdes | 308/308 | 100% | ✅ |

## Detalle por regla

### R0 — Tests validan requisito, no implementación
- ❌ **El bug del timezone lo demostró**: el spec de `parse-date` asertaba `2026-09-16T00:00:00Z` (UTC) y "pasaba" con la implementación bugueada. Ya corregido (commit `c7d20fa`), pero el **patrón sigue vivo**: 43 specs afirman `toHaveBeenCalledWith(...)` sobre mocks sin validar la semántica requerida (R-U-10/11).

### 01 — Unit
- 🟡 Nombres de test en formato aceptable (`should X when Y`) ✓ en muestreo.
- ❌ **R-U-17**: 81/95 archivos de `domain/` sin spec — graves: `attendance` (factory, event entity, VOs), `users` (Vos, factories, entities), `schedules` (4 VOs), `positions` (factory+VOs), `shifts`, `reports`, `core/domain` (result.vo, time-range.vo).
- ❌ **R-U-10/11**: solo 2 controllers tienen spec (`attendance`, `audit`); el resto de controllers no cubiertos; los specs existentes asertan llamadas a mocks (el modo exacto de falla del bug original).
- ❌ **R-U-18**: use-cases de `auth`, `devices`, `sync`, `reports/export` sin specs correspondientes en varias rutas.
- ❌ **R-FL-3**: `test/jest.setup.ts` solo contiene `jest.setTimeout(30000)` — **no fija `TZ`**; los tests dependen de la timezone de la máquina.

### 02 — Integración (API+BD)
- ❌ R-I-1 … R-I-13: **0 tests**. No existe `supertest` en dependencias. La clase de bug que originó este documento (filtros de fecha) solo se detecta aquí (R-I-2/R-I-3).

### 03 — E2E
- ❌ **Suite rota**: `backend/test/jest-e2e.json` contiene `module.exports = {...}` (JS), Jest falla con `JSONError`. El job `e2e` de CI (`ci.yml:135`) **no puede pasar**.
- ❌ R-E-1..7: `app.e2e-spec.ts` solo prueba bootstrap ("app definida" + `SELECT 1`). Ningún flujo real.
- ❌ R-E-13: los smokes de frontend (login, dashboard, history…) están en `/tmp/opencode/smoke/`, fuera del repo y sin `package.json` propio.
- ❌ R-E-8: no hay asertación de "cero errores de consola" automatizada en CI.

### 04 — Contrato
- ❌ R-C-1 … R-C-11: **0 tests de contrato**. No hay schemas de respuesta; Swagger no se verifica en CI (R-C-7/G-8).

### 05 — Robustez
- ❌ R-PB-1..3: sin `fast-check` ni invariantes (parse-date, cálculo de asistencia candidatos ideales).
- ❌ R-MT-1..2: sin Stryker; mutación nunca ejecutada.
- ❌ R-RB-1..4: sin fuzz de parsers (query params, CSV, payload ZK).
- ✅ R-REG-1 reciente: el fix del timezone **sí** incluyó specs que asientan el requisito correcto (ejemplo a seguir).

### 06 — Cobertura y gates de CI (`.github/workflows/ci.yml`)
| Gate | Estado | Evidencia |
|---|---|---|
| G-1 unit backend | ✅ | `ci.yml:49` `npx jest --ci` |
| G-2 unit frontend | ❌ | job frontend solo lint + tsc + build (`ci.yml:81-88`); **no ejecuta `ng test`** |
| G-3 coverage ≥umbrales | ❌ | sin `coverageThreshold` en `jest.config.js` ni step de cobertura |
| G-4 integración | ❌ | no existe la suite |
| G-5 contrato | ❌ | no existe la suite |
| G-6 E2E release | ❌ | job existe pero la suite está rota (JSONError) |
| G-7 lint/tsc/build | ✅ | ambos jobs |
| G-8 Swagger sync | ❌ | no verificado |

## Hallazgos críticos (ordenados por severidad)

1. **Cobertura backend 38.8%** vs 80% exigido; `users.controller` 0%, repos Prisma de users 0%, dtos 0%.
2. **Suite e2e backend rota** (`jest-e2e.json` = JS en archivo .json) → el gate de CI E2E no es funcional.
3. **0 tests de integración API+BD** — única capa que habría detectado el bug de timezone en producción.
4. **0 tests de contrato** — cambios de shape pueden romper frontend sin fallar ningún test.
5. **81/95 archivos `domain/` sin spec** (R-U-17).
6. **Frontend sin `ng test` en CI** + karma bloqueado localmente (EACCES `.angular/cache` de root).
7. **43 specs mock-solo** — validan implementación, no requisito (origen del bug).
8. **`TZ` no fijada en los tests** — reproducibilidad comprometida.
9. **Sin property-based ni mutation testing.**
10. **E2E de frontend no versionado** (scripts en `/tmp`).

## Plan priorizado de remediación

### Fase A — Inmediato (estabilizar gates)
1. **A1** — Corregir `backend/test/jest-e2e.json` a JSON válido; verificar localmente `npm run test:e2e` y que el job `e2e` de CI pase. (R-E-12, G-6)
2. **A2** — Fijar `process.env.TZ = 'America/Managua'` en `test/jest.setup.ts` y en el setup de tests del frontend. (R-FL-3)
3. **A3** — Agregar `coverageThreshold` a `jest.config.js` + step `test:cov` en CI con ratchet documentado: gate inicial **38% → +5 pts por release hasta 80%** (desviación controlada de R-COV por deuda histórica, registrada aquí). (G-3)
4. **A4** — Activar `ng test --watch=false` en el job frontend de CI. (G-2)

### Fase B — Corto plazo (tapar el hueco que causó el bug)
5. **B1** — Suite de **integración API+BD** con `supertest` + BD efímera: login+authz (R-I-4/5), **attendance con filtros de fecha day-boundary** (R-I-2/3), paginación conserva filtros, CRUD empleado. (G-4)
6. **B2** — **Tests de contrato** mínimos: envelope `{data,total,page,limit}`, fechas ISO-Z (R-C-4), shape de errores (R-C-8), schema de `Employee`/`AttendanceRecord`. (G-5)
7. **B3** — Specs de `domain/` prioritarios: `attendance` (factory/VOs/event), `users` (Vos/factories), `schedules` VOs → bajar de 81 a <40 sin spec. (R-U-17)

### Fase C — Pre-release
8. **C1** — E2E de frontend **versionado en repo** (Playwright) con los 7 flujos críticos (R-E-1..7), incl. asertación de "0 errores de consola" y filtro de fecha por día local (R-E-4). (G-6)
9. **C2** — Property-based con `fast-check` para `parse-date` (partición del rango por días locales) y cálculo de asistencia (R-PB-1..3).
10. **C3** — Stryker sobre `auth`, `attendance`, `devices` ≥70% mutantes eliminados (R-MT-1/2).

### Regla de aprobación
Ninguna fase se da por cerrada sin re-ejecutar esta auditoría y actualizar las métricas (R-COV-3).

---

## Estado post-Fase A (2026-09-25)

| Ítem | Resultado |
|---|---|
| **A1** Suite e2e backend | ✅ `test/jest-e2e.json` reescrito como JSON válido; `npm run test:e2e` → **2/2 en verde** (bootstrap + conexión Prisma; token corregido a `app.get(PrismaService)`). CI: paso `migrate deploy` cambiado a `prisma db push` (el repo no tiene `prisma/migrations/`). |
| **A2** TZ determinista | ✅ `TZ=America/Managua` fijado vía `setupFiles` → `backend/test/tz.setup.ts` (unit + e2e, corre antes de cualquier import) y en `karma.conf.js` (Chrome hereda el env). Regla R-FL-3. |
| **A3** Gate de cobertura backend | ✅ `coverageThreshold` en `jest.config.js`: statements 40 / branches 41 / functions 42 / lines 38 (baseline 2026-09-25, ratchet +5/release). CI corre `jest --coverage`. |
| **A3** Gate de cobertura frontend | ✅ `check` en `karma.conf.js`: statements 44 / branches 32 / functions 37 / lines 43. **Verificado que FALLA**: umbral 99% → `EXIT=1` + "does not meet global threshold". |
| **A4** `ng test` en CI | ✅ Paso agregado al job frontend. **Hallazgo clave**: `angular.json` no declaraba `karmaConfig` → Angular nunca cargaba `karma.conf.js` (gate y TZ eran decorativos). Agregado `"karmaConfig": "karma.conf.js"`. |
| **Fix extra** | ✅ `frontend/.angular/cache` era root-owned (Docker) → `chown 1000:1000`; documentado en README. Igual que `backend/dist` (afectaba `nest build`). |

### Hallazgos adicionales descubiertos al estabilizar CI (nuevo en Fase A)

Al simular localmente los 3 jobs de CI se descubrió que **ninguno había podido pasar nunca**:

| # | Hallazgo | Fix aplicado |
|---|---|---|
| 1 | `.gitignore` ignoraba **`frontend/angular.json`** y **`backend/nest-cli.json`** (nunca commiteados) → `ng build/ng test` y `nest build` imposibles en CI | Negaciones `!frontend/angular.json`, `!backend/nest-cli.json` + archivos trackeados |
| 2 | Backend **sin config de ESLint** → `npx eslint` fallaba siempre | Nuevo `backend/.eslintrc.js` (eslint 8 + @typescript-eslint ya instalados) |
| 3 | Frontend **sin script `lint`** → `npm run lint` fallaba | `lint`/`lint:fix` con Prettier + formateo de 62 archivos |
| 4 | Backend: `exclude` del tsconfig (previo) reemplazó los defaults → **`dist/` entraba al programa** y su `.d.ts` chocaba con el mock (tsc roto) | `exclude` ampliado: `dist/**`, `node_modules/**`, `coverage/**` |
| 5 | Frontend `tsc --noEmit` caía por `cypress/` sin instalar + `base.store.ts` con import roto (`./domain.models` inexistente) | `exclude` de cypress en tsconfig + import corregido a `../models/domain.models` + cast de `state` (3 sitios) |
| 6 | `zkteco.client.ts` usaba `/// <reference>` (error `triple-slash-reference`) | Eliminado (el `.d.ts` se resuelve vía tsconfig) |
| 7 | ESLint encontró **853 problemas reales**: 299 `no-unused-vars`, 62 `no-var-requires` (require() inline en módulos/repos generados) | `no-unused-vars` y `no-var-requires` → **`warn`** con ratchet documentado (ver deuda); reglas de error = 0 tras fixes |
| 8 | **El workflow de CI nunca ejecutó ni un job**: `services.ports: 5432:5432` es un escalar YAML, GitHub exige secuencia → los 3 jobs fallaban al instante con 0 jobs en TODOS los runs históricos (validado con `actionlint`) | `ports:` convertido a secuencia |
| 9 | `pnpm/action-setup@v4` con `version: 9` choca con `packageManager: pnpm@9.0.0` del package.json → los 3 jobs fallaban en "Setup pnpm" | Input `version` eliminado (se usa `packageManager`) |
| 10 | `prisma validate` en CI: `Environment variable not found: DATABASE_URL` (no hay `.env` en CI) | `DATABASE_URL` dummy agregado al paso |

**Deuda de lint registrada (burn-down obligatorio, ratchet +10% por release):** 850 warnings
(≈299 unused-vars, ≈62 no-var-requires, resto `no-explicit-any`). Prohibido subir el conteo.

### Métricas post-Fase A

| Métrica | Antes | Después |
|---|---|---|
| Backend tests | 308/308 ✅ | 308/308 ✅ + gate 38/41/42/40 |
| Backend e2e | rota (JSONError) | **2/2 verdes** ✅ |
| Frontend tests | no corrían localmente | **105/105 verdes** ✅ + gate 43/32/37/44 |
| Gates CI activos (G-1..G-8) | 0/8 reales — **el workflow nunca corrió ni un job** | **5/8 en CI real ✅ (run 36157546843, 3/3 jobs verdes)**: G-1, G-2, G-3, G-7 ✅; G-6 ⚠️ (e2e pasa pero solo bootstrap). Faltan G-4, G-5, G-8 |
| Lint | roto (sin config/script) | backend 0 errores / 850 warns; frontend prettier ✓ |
| Faltan para Fase B | — | G-4 (integración), G-5 (contrato), specs de domain |

**Ejecuciones locales de verificación:**
```bash
cd backend  && npm run test       # 74 suites / 308 tests ✅
cd backend  && npm run test:cov   # ✅ gate de cobertura pasa
cd backend  && npm run test:e2e   # 2/2 ✅ (requiere Postgres local)
cd frontend && pnpm exec ng test --watch=false --code-coverage --browsers=ChromeHeadless  # 105 ✅

# CI real (GitHub Actions) — run 36157546843 (commit 8324a38): 3/3 jobs verdes ✅
# https://github.com/xozan845-ctrl/zkteco-attendance-performance/actions
```

---

## Estado post-Fase B (2026-09-25)

**Comandos:** `npm run test:cov`, `npm run test:integration`, `npm run test:contract`,
`npm run test:e2e`, `npm run lint`, `npx nest build`.

| Ítem | Resultado |
|---|---|
| **B1** Integración API+BD (G-4) | ✅ **26 tests / 3 suites verdes** en `backend/test/integration/` (`auth`, `employees`, `attendance-day-boundary`). Harness propio en `test/helpers/harness.ts`: arranca el `AppModule` real con `configureApp()` (mismo pipeline que producción) en puerto efímero y habla **HTTP real con `fetch`** (Node 20) contra **BD real** — sin `supertest` (desviación de B1: equivalente en fidelidad y cero dependencias nuevas). Usuarios de test autocontenidos e idempotentes (funcionan en BD sin seed, R-I-11); cleanup por rango de ids únicos por ejecución (R-I-10). |
| **B2** Contrato (G-5) | ✅ **10 tests / 1 suite verdes** en `backend/test/contract/api-contract.e2e-spec.ts`: envelope `{data, meta}` con paginación dentro de `data` (R-C-1), fechas ISO-8601 con `Z` (R-C-6), formas de error 401/404/400 uniformes con `timestamp`/`path` (R-C-8), login sin `password`/`$argon2` (R-C-3), `/docs` + `/docs-json` con rutas bajo `/v1/` (R-C-4/R-C-7). |
| **B3** Specs de domain (R-U-17) | ✅ 5 specs agrupados (`users-domain`, `schedules-domain`, `attendance-domain`, `employees-vos`, `core-vos`, `auth-user-entity`) = **+98 unit tests** (308 → **411**). Cobertura de archivos `domain/`: **81.29% líneas / 75.66% stmts** (quedan 30 archivos a 0%: interfaces, events y repos — sin lógica ejecutable o de menor valor). |
| **CI** | ✅ `ci.yml` job e2e ahora: `E2E (bootstrap)` + **`Integration tests (G-4)`** + **`Contract tests (G-5)`** como pasos separados. |

### Bugs reales cazados y corregidos durante la Fase B (evidencia de R0/R-I)

Los tests de integración/contrato contra el requisito (no contra la implementación)
destaparon **10 defects** que ninguna suite anterior podía ver:

| # | Defect | Fix |
|---|---|---|
| 1 | **`getTimezoneOffsetMinutes` hardcodeaba UTC-5 para `America/Managua`** (real: **UTC-6**, verificado con `date`) → los días locales arrancaban 1 hora tarde. Los unit specs de Fase A habían *bloqueado el valor incorrecto* (de nuevo: test ≠ requisito) | Offset dinámico vía `Intl.DateTimeFormat` (cualquier IANA + DST); specs reescritos con valores reales (Managua 06:00Z, Bogotá 05:00Z, Madrid con DST) |
| 2 | Repo de asistencia usaba `lt` con el fin **inclusivo** (`23:59:59.999`) → perdía el último milisegundo del día (`audit`/`reports` ya usaban `lte`) | `lt` → `lte` en `prisma-attendance-record.repository.ts` |
| 3 | `audit.dateFrom` usaba `parseOptionalDate` (medianoche **UTC**) mientras `dateTo` usaba día **local** → rango asimétrico | `parseOptionalRangeStart` en `audit.controller` |
| 4 | 5 endpoints (`employees/positions/schedules/shifts/users` GET :id) devolvían **500** en vez de 404 (`throw new Error`) | `NotFoundException` (contrato Swagger) |
| 5 | **Login/refresh exponían el hash argon2** (`user.password`) | `User.toJSON()` seguro + test de contrato R-C-3 |
| 6 | `AuthUseCase` firmaba/verificaba JWT con `secret` **sin fallback** → login = 500 en CI (sin `.env`) | Fallbacks alineados con `AuthModule`/`JwtStrategy` |
| 7 | `prisma/seed.ts` con `}` faltante (sintaxis rota; invisible porque nada lo compilaba) | Corregido; el build ahora lo incluye en el chequeo |
| 8 | Sin `tsconfig.build.json` → `nest build` emitía `dist/src/main.js` + `dist/test/` (**el CMD de la imagen prod `node dist/main.js` no podía arrancar**) | `tsconfig.build.json` con excludes; verificado `dist/main.js` |
| 9 | `configureApp` vivía solo en `main.ts` (prefijo fallback `api/v1` + versioning = `/api/v1/v1` en CI sin `.env`) | Extraído a `src/app.setup.ts` compartido main↔tests; fallback `api` |
| 10 | **`RolesGuard` global sin ningún `@Roles()`** en el codebase → la autorización por rol del backend no está aplicada (solo autenticación). *No fixeado (scope):* backlog Fase C | Registrado como hallazgo |

**Métricas post-Fase B**

| Métrica | Post-Fase A | Post-Fase B | Mínimo R-COV |
|---|---|---|---|
| Backend unit tests | 308/308 ✅ | **411/411 ✅** (80 suites) | 100% |
| Cobertura lines | 38.81% | **40.82%** (gate 38 ✅) | 80% (ratchet +5/release) |
| Cobertura statements | 40.07% | **43.63%** (gate 40 ✅) | 80% |
| Cobertura branches | 41.15% | **45.16%** (gate 41 ✅) | 70% |
| Cobertura functions | 42.37% | **50.29%** (gate 42 ✅) | 80% |
| Domain files `lines%` | — | **81.29%** | — |
| Tests integración | 0 | **26** ✅ (G-4) | ≥1 por flujo crítico |
| Tests contrato | 0 | **10** ✅ (G-5) | ≥1 por shape |
| Tests e2e bootstrap | 2 | 2 ✅ | — |
| Gates CI (G-1..G-8) | 5/8 | **7/8 ✅**: G-1, G-2, G-3, G-4, G-5, G-7, G-8; G-6 ⚠️ (solo bootstrap, E2E real = Fase C) | 8/8 |
| Lint backend | 0 err / 850 warns | **0 err / 729 warns** (burn-down: `any` permitido en `test/**`+specs) | ratchet ≤850 |

**Verificación local (todo en verde):**
```bash
cd backend
npm run test           # 411/411 ✅
npm run test:cov       # ✅ gate 38/41/42/40 pasa (40.82/45.16/50.29/43.63)
npm run test:integration  # 26/26 ✅ (requiere Postgres local)
npm run test:contract     # 10/10 ✅
npm run test:e2e          # 38/38 ✅ (bootstrap 2 + integración 26 + contrato 10)
npm run lint              # 0 errores / 729 warnings
npx nest build             # ✅ dist/main.js (layout correcto p/ imagen prod)
```

**Pendiente (Fase C):** G-6 E2E reales de flujo (Playwright versionado), property-based
(`fast-check`) para `parse-date` y cálculo de asistencia, mutation testing, y el backlog
`@Roles()`/`RolesGuard` sin uso (hallazgo #10).

## Estado post-Fase C (Parcial) - 2026-09-25

### Resumen de métricas
- **Tests totales**: 497 (488 backend + 9 E2E)
- **Backend**: 87 suites, 488 tests verdes
- **E2E Playwright**: 9 tests verdes (9/9 flujos R-E-1,2,3,4,5,7)
- **Lint**: 0 errores / 729 warnings (backend) + 0 (frontend)
- **Build**: Backend + Frontend OK
- **Cobertura property-based**: 19 tests nuevos (parse-date + attendance-calculation)

### Flujos E2E validados (R-E-1..R-E-7)
| Regla | Descripción | Test | Estado |
|-------|-------------|------|--------|
| R-E-1 | Login admin → dashboard + KPI real | `auth.spec.ts` | ✅ |
| R-E-2 | Login inválido → error + form intacto | `auth.spec.ts` | ✅ |
| R-E-3 | Lista empleados + búsqueda + paginación | `employees.spec.ts` | ✅ |
| R-E-4 | Filtro asistencia por fecha (básico) | `attendance.spec.ts` | ✅ |
| R-E-5 | Paginación conserva página | `pagination.spec.ts` | ✅ |
| R-E-7 | Logout limpia sesión | `logout.spec.ts` | ✅ |

### Pendientes Fase C
1. **C1 - E2E completo**: R-E-6 (guardia de rol), CRUD completo empleado
2. **C3 - Mutación (Stryker)**: Score 16.4% → objetivo ≥70%
   - Mutantes sin cobertura: 1253/1616
   - Prioridad: devices.service (394), zkteco.client (391), repos, auth.use-case, controllers

### Hallazgos property-based (C2)
- Managua UTC-6 desde 2000; 1992-1999 fue UTC-5 (dato ICU)
- Ancla absoluta UTC-6 validada para años 2010+
- 19 tests property-based pasando (parse-date P1-P9 + attendance-calculation P1-P9)

### Commit 8ca164d - C1 E2E completado (R-E-4, R-E-6)

**Flujos E2E validados (10/10 tests verdes):**

| Regla | Test | Estado |
|-------|------|--------|
| R-E-1 | Login admin → dashboard + KPI real | ✅ |
| R-E-2 | Login inválido → error + form intacto | ✅ |
| R-E-3 | Lista empleados + búsqueda + paginación | ✅ |
| R-E-4 | Filtro día D (boundary 23:30 incluido, D-1/D+1 excluidos) | ✅ |
| R-E-5 | Paginación conserva página + filtro | ✅ |
| R-E-6 | Guardia rol: usuario sin permisos → redirigido a dashboard | ✅ |
| R-E-7 | Logout limpia sesión + recarga no restaura | ✅ |

**Fixtures DB para E2E:**
- Usuario limitado: `e2e-limited@example.com` / `E2eLimited1!` (sin roles/permisos)
- Dispositivo: `e2e-device` 
- Empleado: `E2E001`
- Registros asistencia (Managua local):
  - D (22/09): 08:00 CHECK_IN, 23:30 CHECK_OUT (boundary → UTC día siguiente)
  - D-1 (21/09): 09:00 CHECK_IN
  - D+1 (23/09): 09:00 CHECK_IN

**Totales:** 488 backend + 10 E2E = 498 tests verdes | CI 3/3 verde

### Commit - devices.service.spec.ts (mutación devices.service 0% → 16.31%)

- Tests unitarios para DevicesService (12 tests)
- Cobertura: create, findAll, findOne, findDefault, update, remove
- Mutation score devices.service: 0% → 16.31% (45/394 mutantes asesinados)
- Score global Stryker: 16.4% → 24.68% (363/1471 mutantes asesinados)

---

## Estado post-Fase C (Completo) — 2026-09-26

**Fase A ✅ · Fase B ✅ · Fase C ✅ — plan de remediación cerrado (R-COV-3).**

### C3 — Mutación (Stryker) ✅ CUMPLE R-MT-2 (≥ 70%)

- **Alcance (R-MT-1):** `src/modules/auth/**`, `src/modules/attendance/**`, `src/modules/devices/**` (specs, `index.ts`, `.d.ts` excluidos). Config en `backend/stryker.conf.js`: runner `@stryker-mutator/jest-runner`, `coverageAnalysis: perTest`, `thresholds.break: 70` (gate que **falla** la ejecución si el score baja de 70).
- **Ejecución local:** `cd backend && pnpm exec stryker run` (~6 min). Reporte `backend/stryker-report.html` (gitignoreado).

| Métrica | Antes (2026-09-25) | Después (2026-09-26) |
|---|---|---|
| **Score mutación (total)** | 33.40% | **98.08%** ✅ |
| Mutantes eliminados (Killed) | 313/937 | **919/937** |
| Survived | 156 | **17** |
| NoCoverage | 468 | **1** |
| Score sobre código cubierto | 66.74% | 98.18% |

Detalle por archivo (mutantes sin asesinar):

| Archivo | k/s/n | Nota |
|---|---|---|
| `devices/application/devices.service.ts` | 383/10/1 | ~8 equivalentes (`??`→`\|\|` con boolean, `spaceIdx` tras `.trim()`) |
| `attendance/domain/services/attendance-calculation.service.ts` | 141/4/0 | equivalentes (`if(false)` inalcanzable, StringLiteral con NaN) |
| `attendance/application/use-cases/process-attendance-events.use-case.ts` | 27/2/0 | optional-chaining equivalente (`events[0]` siempre existe) |
| `auth/infrastructure/repositories/prisma-user.repository.ts` | 36/1/0 | residual |
| Resto de archivos del alcance | 132/0/0 | **100%** |

### Métricas finales de la suite

- **Backend:** 90 suites / **641 tests** verdes (baseline Fase A: 74/308).
- **Cobertura backend:** lines **55.80%** (38.81 → 55.80), statements 55.54, branches 59.42, functions 60.74. Ratchet de `jest.config.js` subido a 55/59/60/55 (G-3, anti-regresión R-COV-1).
- **E2E Playwright:** 10/10 (R-E-1..R-E-7, G-6).
- **Property-based:** 19 tests fast-check (R-PB-1..3).
- **Lint backend:** 0 errores; **build:** backend + frontend OK.

### Tests añadidos en C3 (+141 tests, ~2.4k líneas de spec)

| Spec | Tests | Foco |
|---|---|---|
| `devices.service.spec.ts` | 12 → 70 | sync, import, getStatus, logs, testConnection, processAttendanceRecords, clamps |
| `attendance-calculation.service.spec.ts` | 8 → 35 | boundary graceMinutes/turno nocturno/overtime/diffMinutes |
| `prisma-attendance-record.repository.spec.ts` | 6 → 25 | filtros, paginación, `$transaction`, mapeo toDomain |
| `auth.use-case.spec.ts` | 6 → 19 | refresh, firma de tokens, defaults de entorno, validateToken |
| `auth.controller.spec.ts` | nuevo (6) | login/register/refresh/logout + errores 401 |
| `prisma-user.repository.spec.ts` | nuevo (7) | findByEmail/findById/save/findByRole + toDomain |
| `prisma-attendance-event.repository.spec.ts` | 6 → 10 | saveMany, findByHash, deleteByDeviceId |
| `attendance.controller.spec.ts` | 5 → 8 | filtros findByEmployee/findRecords |
| `process-attendance-events.use-case.spec.ts` | 3 → 5 | trazabilidad, agrupación |
| entity/factory/attendance-domain | +3 | workedMinutes 480, timestamp de creación |

### Deudas abiertas (post-cierre del plan)

1. **Cobertura global 55.8% vs 80%** del gate G-3 (ratchet es el mecanismo de anti-regresión; subir +5 pts/release).
2. **G-2**: frontend aún sin `ng test` en CI; **G-8**: Swagger sync sin verificar.
3. **R-RB-1..4**: sin fuzz de parsers (query params, CSV, payload ZK).
4. **Mutantes Survived residuales (17):** equivalentes identificados; R-MT-3 sugiere documentarlos/eliminar tests que no matan nada (ninguno identificado como test inútil en esta iteración).

### Evidencia CI (cierre de Fase C)

- Commit `0e31e4b` → GitHub Actions run `36254496313`: **3/3 jobs verdes** ✅
  - `Backend (lint + tsc + tests + build)` — 90 suites / 641 tests + ratchet 55/58/60/55
  - `E2E (PostgreSQL + db push + e2e tests)` — 10/10 Playwright
  - `Frontend (lint + build)`
- Gate local de mutación verificado: `pnpm exec stryker run` → exit 0, *"Final mutation score of 98.08 ≥ break threshold 70"*.

---

# AUDIT (histórico) — Auditoría post G-6/G-8 + alcance de cobertura R-COV-4

- **Fecha:** 2026-09-27
- **Comando:** `npm run test:cov` (backend), `npx jest --config ./test/jest-e2e.json` (integración/contrato/bootstrap), `npx ng test --watch=false --browsers=ChromeHeadless` (frontend), `pnpm --filter zkteco-e2e exec playwright test`, `npm run swagger:export` ×2 + `git diff --exit-code`, inspección de `ci.yml`.
- **Estado global:** 🟡 **CUMPLE PARCIAL** — **8/8 gates de CI** (antes 6/8: G-6 y G-8 cerrados); deudas: fuzz (R-RB), specs de dominio (R-U-17), ratchet de cobertura backend/frontend, RolesGuard.

## Cambios desde la auditoría anterior (2026-09-26)

- **R-MT-2** enmendada con rangos: ≥90% críticos / ≥80% otros / <70% bloquea release; `stryker.conf.js` `break: 70 → 90` (verificado: 98.08 ≥ 90).
- **R-COV-4** nueva — alcance del gate: fuera `*.module.ts` (wiring DI), `/dto(s)/`, `/mocks/`, scripts CLI, `main.ts` y `/types/`; **ratchet legalizado en `06`/G-3** (+5 pts/release hasta 80/70/80).
- Gate backend `jest.config.js`: **55/58/60/55 → 63/61/63/63** (baseline medido con alcance: lines 64.07 / branches 62.44 / functions 64.70 / statements 64.27; margen 1pt de varianza).
- **G-6 activo:** job `Playwright E2E de flujos` en el workflow con `if: github.event_name == 'push'` (push a main, no PR) y `webServer` en `e2e/playwright.config.ts` (arranca `node dist/main.js` + `ng serve`; `reuseExistingServer` en local).
- **G-8 activo:** `configureApp` devuelve el documento OpenAPI; `backend/scripts/export-swagger.ts` (`npm run swagger:export`) + paso CI `git diff --exit-code -- docs/openapi.json` (56 paths / 32 schemas, determinista ×2).
- **R-COV-3 (esta auditoría):** snapshot reescrito con cifras medidas; README raíz con guía completa de Testing.

## Métricas medidas (2026-09-27)

| Métrica | Valor |
|---|---|
| Unit backend | 90 suites / **641 tests** ✅ |
| Cobertura backend (alcance R-COV-4) | lines **64.07** / statements **64.27** / branches **62.44** / functions **64.70** — gate 63/61/63/63 exit 0 |
| Integración / Contrato / Bootstrap | **26** / **10** / **2** ✅ |
| Unit frontend | **75/75** ✅ (gate karma 44/32/37/43) |
| Playwright (vía `webServer`) | **10/10** ✅ (37.1s) |
| OpenAPI | 56 paths / 32 schemas, export ×2 idéntico, diff limpio ✅ |
| Property-based | 19 tests (18 `fc.property` + 1 unit) |
| Mutación | 98.08% ≥ break 90 ✅ |
| `domain/` sin spec (R-COV-2) | 78 de 95 (23 VO, 15 interface, 14 event, 10 entity, 7 factory, 9 otros) ❌ |

## Correcciones de la auditoría anterior

- Frontend "105/105 verdes" → **error**: medido **75/75**.
- Deuda "30 de 95 archivos `domain/` sin spec" → conteo con semántica de R-COV-2: **78 de 95** (40 en categorías nombradas por R-U-17: VO/entity/factory).
- Evidencia anterior citaba el job E2E con "10/10 Playwright" en CI: **no existía** paso Playwright en `ci.yml` (G-6 estaba ❌); hoy existe el job `playwright`.

## Evidencia

- Local (2026-09-27): todas las filas de la tabla anterior ejecutadas en verde con los mismos comandos que el workflow; `tsc --noEmit` ✅; YAML del workflow parseado (4 jobs).
- CI: los pushes de los commits `b9d9cd0` (G-6/G-8) y de esta auditoría disparan los runs de evidencia remota (repo privado; la sesión no tiene `gh` para citar run IDs).

---

# AUDIT (histórico) — Fix de fixtures E2E tras el primer run de G-6 en CI

- **Fecha:** 2026-09-27
- **Disparador:** run de Actions del commit `b9d9cd0` → job `Playwright E2E de flujos (G-6)` **8/10 (2 failed)**:
  - `R-E-4` (asistencia): esperaba 2 registros de `E2E001` el 2026-09-22 → 1 — la BD de CI (fresca + seed) no tenía el empleado ni los registros; solo existían en la BD local con historial de desarrollo.
  - `R-E-6` (guard de rol): login `e2e-limited@example.com` → "Credenciales inválidas" — `prisma/seed.ts` no creaba ese usuario.
- **Causa raíz:** la suite E2E no era hermética (fixtures creados a mano en dev). El gate G-6, recién activo, los detectó en su primer run — exactamente lo que debe hacer.
- **Fix:**
  - `prisma/seed.ts`: fixtures E2E idempotentes — usuario `e2e-limited@example.com` **sin roles** (R-E-6), empleado `E2E001` y 4 attendance records (D-1/D/D+1 = 2026-09-21..23 con boundary 08:00/23:30 en hora local -06:00; `deleteMany` + `createMany` → determinista en BD fresca o con historial).
  - `ci.yml`: `TZ: America/Managua` en el paso Playwright (paridad backend/seed/navegador con local, R-I-3).
- **Verificación local en BD fresca estilo CI** (`zkteco_e2e_verify`: `db push` + seed + Playwright con env de CI): **10/10 verdes (39.6s)** — incluidos los 2 tests que fallaron. Seed corrido 2 veces → 4 records / 1 user / 0 roles (idempotente).

# AUDIT (histórico) — R-ES-18 sobre los 14 stores y cierre de D-FE-6 (trazas de polling y sync)

- **Fecha:** 2026-09-28
- **Disparador:** petición de auditar todos los stores contra la regla de registro
  de consola (`rules/frontend/04-estado-rxjs.md` → R-ES-18).
- **Alcance:** los 14 `*.store.ts` (3 en `core/stores/`, 11 en `features/*/stores/`)
  y verificación global de las prohibiciones en `frontend/src`.
- **Resultado:**
  - Prohibiciones globales cumplidas: **0 `console.log` y 0 `console.warn`**
    (D-FE-4 se mantiene cerrada).
  - 49 llamadas `console.*` (7 debug, 29 info, 13 error): **49/49 con prefijo
    `[<ÁREA>:<Origen>]`**, verificado con parser (el grep por línea pierde las
    llamadas multilínea).
  - **D-FE-6 (nuevo, cerrado):** dos flujos críticos de la lista de R-ES-18
    muerían en silencio — `attendance.store` (arranque/detención de polling) y
    `device.store` (sincronización) no trazaban nada. Fix: 6 trazas nuevas
    (4 `info` de inicio/resultado + 2 `error` de fallo), con mensaje, datos y
    error como argumento aparte.
  - Los 10 stores CRUD sin trazas **no** violan la regla: R-ES-18 solo exige
    traza inicio→fin en los flujos críticos (login/refresh, reportes, sync de
    dispositivo, polling); sus fallos HTTP ya quedan registrados por
    `error.interceptor`.
- **Tests:** +1 test (ciclo de vida del polling con aserción de ambas trazas) y
  aserciones de traza añadidas a los 2 tests de sync de `device.store.spec` →
  118/118 en verde; cobertura 53.78/40.86/45.06/53.42 (sube en los 4 ejes sobre
  el baseline 53.35/40.43/44.44/52.97 — R-COV-1).
- **Evidencia local:** prettier ✓, `tsc --noEmit` ✓, `ng test --code-coverage`
  (118/118) ✓, `ng build` ✓. CI verificada con `gh` en el commit de este fix (R-CI-6).

# AUDIT (histórico) — Feature: Horario heredado por departamento (Department Schedule Inheritance)

- **Fecha:** 2026-09-28
- **Disparador:** requerimiento de negocio — los empleados deben heredar el horario de su departamento cuando no tienen asignación personal.
- **Alcance:** backend + frontend (módulo `departments`, herencia en ausencias/reportes/empleado).
- **Cambios clave:**
  - **Schema:** nuevo modelo `DepartmentSchedule` (departmentId, scheduleId, shiftId?, effectiveFrom, effectiveTo) con relaciones a Department/Schedule/Shift.
  - **Backend CRUD:** `PUT/GET/DELETE /departments/:id/schedule` (asignar, consultar, revocar).
  - **Herencia en ausencias:** `PrismaAbsenceRepository` consulta `department.schedules` y mezcla con horarios personales; dominio `effectiveSchedule` aplica precedencia personal > departamento día a día.
  - **Herencia en reportes:** `PrismaReportRepository.getEmployeeSchedules` replica horarios de departamento por empleado; `ReportCalculationService.effectiveSchedule` misma precedencia.
  - **GET empleado:** `getCurrentSchedule` devuelve horario heredado con `inherited: true` si no hay personal.
  - **Frontend:** sección "Horario" en `department-form` (select + vigencia + revocar); badge "Heredado del departamento" en `employee-form`.
  - **Tests:** unitarios (use cases, repo, dominio), integración (ausencias con herencia), contrato (endpoints nuevos), 118/118 frontend + 758 backend.
- **Cobertura:** backend 66.62/66.48/66.53/67.40 (sube); frontend 53.78/40.86/45.06/53.42 (estable).
- **Reglas R-ES:** todas ✅ (18/18) — la feature usa `signalStore`, `rxMethod`, `patchState`, sin estado en servicios, sin suscripciones manuales.
- **Evidencia CI:** pending (push + gh run watch R-CI-6).

---

# AUDIT (histórico) — Ratchet de cobertura del frontend legalizado (R-COV-5) y resnapshot completo

- **Fecha:** 2026-09-30
- **Disparador:** cierre de la deuda nº 4 que el propio snapshot anterior dejó
  anotada sin ejecutar — *"gate karma 44/32/37/43 con ratchet comentado en
  `karma.conf.js` pero no legalizado en `rules/test/06`; aplicarle el mismo
  esquema"* — y resnapshot completo de `AUDIT.md` exigido por R-COV-3.
- **Alcance:** `rules/test/06-estandares-cobertura.md`, `rules/test/README.md`
  (Mapa de IDs), `rules/_meta/CHECKLIST.md`, `frontend/karma.conf.js`, sección
  de testing del `README.md` y el snapshot completo de `AUDIT.md`.

## Qué cambió

1. **R-COV-5, nueva.** El ratchet del frontend pasa de ser un comentario en un
   fichero de configuración a ser norma, con el mismo método que ya tenía el
   backend: baseline medido, redondeado a la baja con 1 pt de margen, +5 pts por
   release, tope en la tabla de umbrales y nunca baja (R-COV-1).
2. **Gate de `karma.conf.js` subido de 44/32/37/43 a 52/40/44/52**, con el
   baseline medido (53.78 / 40.86 / 45.06 / 53.42) anotado en el propio config.
3. **G-3 cita los dos ficheros de configuración** (`jest.config.js` *y*
   `karma.conf.js`), no solo uno.
4. **Recuentos del README corregidos** y sección de gatesPassed de dos a dos
   columnas (threshold + medido) para que la holgura sea visible.
5. **`AUDIT.md` reescrito por completo** con lo medido hoy.

## Por qué el gate estaba obsoleto

La cobertura del frontend subió de 53.35/40.43/44.44/52.97 a
53.78/40.86/45.06/53.42 — el histórico de 2026-09-28 ya lo registraba — pero el
gate se quedó clavado en los valores de su baseline de 2026-09-25. La holgura
creció sola: un PR podía perder entre 8 y 10 puntos de cobertura y CI seguiría
en verde. R-COV-1 dice que ningún PR puede bajar la cobertura respecto a `main`,
y en el frontend eso no era cierto: un umbral obsoleto no falla nunca, solo deja
de proteger.

La diferencia con el backend era de método, no de aplicación: `jest.config.js`
tiene escrito de dónde sale su número, y por eso está a 63/61/63/63 contra un
66.78 medido (unos 3,5 puntos de margen, los mismos que el de una variación
normal entre ejecuciones). `karma.conf.js` no tenía método, solo un valor.

## Hallazgo colateral: la mutación bajó 4 puntos sin señal

Al reejecutar Stryker para el snapshot (el run que el `thresholds.break` exige
pero que nadie había corrido desde hacía meses) salió **94.20%**, no el 98.08%
que afirmaba el snapshot: 1070 killed / 65 survived / 2 timeout / 1 sin
cobertura, sobre 1138 mutantes. Los supervivientes pasaron de 17 a 65.

Sigue por encima del break de 90, así que R-MT-2 se respeta y el release no
está bloqueado. Pero la causa de que pasara desapercibida es estructural:
**R-MT-1 acota la mutación a periodicidad mensual o pre-release, así que no hay
ningún paso en CI que la ejecute.** Un umbral que solo se comprueba cuando alguien
se acuerda no avisa de nada. La caída salió al correr el run durante esta
auditoría.

El módulo responsable es `attendance`: 90.86%, con 52 de los 65
supervivientes, frente a `auth` en 99.24% y `devices` en 97.03%.

## Otros números medidos en esta auditoría

| Métrica | Snapshot anterior (2026-09-27) | Medido 2026-09-30 |
|---|---|---|
| backend unit | 641 / 90 suites | **758 / 102** |
| integración (G-4) | 26 | **40** |
| contrato (G-5) | 10 | **15** |
| bootstrap e2e | 2 | 2 |
| frontend unit | 75 | **118** |
| Playwright (G-6) | 10 | 10 |
| cobertura backend (lines) | 64.07% | **67.44%** |
| cobertura frontend | 44/32/37/43 (gate) | **52/40/44/52** (gate), 53.78/40.86/45.06/53.42 medido |
| mutación | 98.08% (17 survived) | **94.20%** (65 survived) |
| `domain/` sin spec | 78 de 95 | **99 de 124** |
| — en categorías de R-U-17 (VO+entity+factory) | 40 | **40** (sin cambio) |
| OpenAPI | 59 paths / 42 schemas | 59 / 42 |
| `fc.property` | 18 en 2 specs | 18 en 2 specs |

El caso de `domain/` merece una línea aparte porque parece una regresión y no lo
es: los **40** ficheros de las categorías que R-U-17 nombra explícitamente siguen
siendo 40, invariados desde 2026-09-28. Lo que cambió es el denominador, de 95
a 124. La foto se movió, la deuda no creció.

## Evidencia

- **Local (comandos idénticos a los de cada job de CI):** unit backend 102/758
  con gate 63/61/63/63 en exit 0 · integración 40/40 ✅ · contrato 15/15 ✅ ·
  bootstrap 2/2 ✅ · frontend 118/118 con gate 52/40/44/52 en exit 0 ✅ ·
  `tsc --noEmit` 0 errores ✅ · `swagger:export` determinista (dos ejecuciones
  byte a byte idénticas) y `git diff --exit-code` limpio ✅ ·
  `pnpm install --frozen-lockfile` sin cambios ✅.
- **Gate de cobertura del frontend probado en las dos direcciones**, porque un
  umbral que nunca falla no protege nada: con 52/40/44/52 la suite sale 0, y
  subiendo `branches` a 99 el job falla con exit 1 y
  `Coverage for branches (40.86%) does not meet global threshold (99%)`.

---

# AUDIT (histórico) — El flujo de PR no estaba normado

- **Fecha:** 2026-09-30
- **Origen:** pregunta del responsable del repo sobre qué parte del flujo de trabajo
  (PR detallados, merges limpios, verificación con `gh`) venía de las reglas y qué
  parte era criterio de quien ejecutaba. Al medirlo, la respuesta fue: la mitad.
- **Comando:** `grep -rn "gh pr" rules/`, `grep -rn -i "rama|branch|merge" rules/`,
  `git rev-list --merges --count origin/main`, `gh pr list --state merged`,
  lectura de `rules/git/01..03.md`, `rules/ci/01-flujos.md` y `_meta/CHECKLIST.md`.

## Qué sí estaba normado (y por eso se hizo sin decidir nada)

| Comportamiento | Regla |
|---|---|
| Stage con rutas explícitas, revisado | R-GA-1, R-GA-2 |
| Commits atómicos, uno por unidad temática | R-GA-3, R-GC-3 |
| Conventional Commits en español citando IDs | R-GC-1, R-GC-4 |
| Verificación antes de commitear | R-GC-5 |
| No reescribir historia publicada | R-GC-7, R-GP-3 |
| Historial lineal, sin merge de sincronización | R-GP-5 |
| **Verificar con `gh` tras el push, sin confiar un verde viejo** | R-GP-6 + R-CI-6 |
| Cuerpo del PR con checklist marcado | `_meta/CHECKLIST.md` ("copiar en la descripción del PR") |
| El PR corre todos los jobs salvo release | R-CI-1 |

## Qué NO estaba normado (y se hizo por criterio propio)

Rama por trabajo sin tocar `main` · planificación por fases · `gh pr create` como
paso del flujo · esperar los checks verdes del PR antes de mergear · estrategia de
merge `--rebase` · verificar el `main` nuevo con `gh` tras el merge · borrar la
rama al cerrar · un PR por hallazgo, en serie.

## El hallazgo

`rules/git/` cubría `add`, `commit` y `push`, y su bloque de verificación daba por
hecho que el trabajo ocurre sobre `main`: `git status -sb` debe reportar
`main...origin/main`, y `git log origin/main..HEAD` es la comprobación previa al
push. `grep -rn "gh pr" rules/` no devuelve **ninguna** coincidencia. Es decir: el
flujo normado era *stage → commit → push a `main` con CI verde*, sin PR en ningún
paso, mientras el CHECKLIST presuponía que el PR existía. Quien solo leyera las
reglas —una persona o otra IA— habría commiteado a `main`, sin PR, sin esperar
checks y con merge commit. Justo lo contrario de lo que se hizo.

## Cerrado en este ciclo

- **`rules/git/04-pr.md` creado** con `R-PR-1..9`: R-PR-1 rama por trabajo y `main`
  alimentado solo por merge · R-PR-2 un PR = una unidad revisable · R-PR-3
  verificación antes de abrir (con excepción `[WIP]` explícita) · R-PR-4 el cuerpo
  es la evidencia (checklist + comando real + resultado) · R-PR-5 commits
  trazables con ID de regla · R-PR-6 checks verdes **en el SHA de la cabeza** ·
  R-PR-7 merge `--rebase`, prohibido `--squash` y merge commit · R-PR-8 verificar
  `main` después del merge, incluido G-6 · R-PR-9 cierre y borrado de rama.
- Mapa de IDs de `rules/git/README.md` y de `rules/README.md` actualizados; nueva
  sección 13 en `_meta/CHECKLIST.md`; este snapshot y esta entrada.

## Evidencia

- `git rev-list --merges --count origin/main` → **0** en 181 commits: el criterio de
  linealidad que ahora fija R-PR-7 ya se cumplía de hecho en los 5 PR anteriores.
- `gh pr list --state merged` → 5 PR (#1–#5), los tres de este ciclo con verificación
  local documentada y run de `ci.yml` verificado en el SHA resultante de `main`.
- El impacto sobre `rules/ci/` es directo: R-CI-1 ya asumía que los PR son la vía
  de entrada; con R-PR-1 queda cerrado el hueco entre esa regla y la práctica real.
- **CI de los 8 gates:** run `36643263353` sobre `main` = `completed success`,
  4/4 jobs (Backend, Frontend, E2E, Playwright G-6).
- **Pendiente de CI en esta misma rama:** el gate nuevo de `karma.conf.js`
  (52/40/44/52) está verificado localmente pero aún no ha pasado por el job de
  frontend. Por R-COV-3, un gate solo se marca ✅ con run verde: el paso de este
  commit es el que lo confirma, y su resultado se registra en la conversación de
  entrega, no en el snapshot (meter un run ID propio aquí crearía un ciclo
  commit → run → commit → run sin fin).
- **Nota de reproducibilidad:** el `build` de backend no se puede reejecutar en
  el entorno de esta auditoría porque `backend/dist` pertenece a `root` y `tsc`
  falla al hacer `unlink` con `EACCES`. Se verificó que es previo a cualquier
  cambio (`npm run build` falla idéntico sin tocar nada) y que la compilación es
  correcta vía `tsc -p tsconfig.build.json --outDir` a un directorio temporal.
  El build sí pasa en CI, que arranca de limpio.

---

# AUDIT (histórico) — Primera auditoría de Core Engine: `_meta/` reescrito a la realidad (R-COV-3)

- **Fecha:** 2026-10-01
- **Disparador:** Etapa 3 del plan de deudas. La deuda estaba declarada en
  `_meta/README.md`: *"`CHECKLIST.md`, `AUDIT.md` y `AUDIT-HISTORY.md` aún
  reflejan el proyecto origen (comandos `pnpm`, `backend/`, `prisma/`, jobs de
  frontend). Se reescriben completos en la primera auditoría de Core Engine
  (R-COV-3)."*
- **Comando:** medición completa por workspace (`npm test` con `--coverage`
  por workspace, ×10), `npm run lint`, `npm run build`,
  `npm audit --audit-level=high`, `gh pr list --state merged`,
  `git rev-list --merges --count origin/main`, inspección de `ci.yml` y de
  `docs/rules/**`.
- **Estado global:** 🟡 **CUMPLE PARCIAL** — G-1/G-3/G-7 efectivos y verdes en
  CI; G-2 N/A; G-4/G-5/G-6/G-8 pendientes; deudas: capas sin suites, robustez
  (PB/MT/RB) sin implementar, cobertura < objetivo, controllers sin specs.

## Métricas medidas (Core Engine, 2026-10-01)

| Métrica | Valor |
|---|---|
| Unit tests | **175 / 175** ✅ en **23 suites** / 10 workspaces (shared 8, api-gateway 6, orders 7, commissions 5, finance 44, market-intelligence 7, catalog 31, identity 24, stores 24, logistics 19) |
| Cobertura (líneas/ramas por workspace) | shared 9.48/5.18 · api-gateway 22.79/8.08 · orders 19.94/13.84 · commissions 12.24/5.08 · finance 48.25/41.82 · market-intelligence 15.42/2.20 · catalog 66.22/76.47 · identity 44.77/52.77 · stores 57.74/72.09 · logistics 81.11/92.59 |
| Gates `coverageThreshold` | **10/10** (floor medido, R-COV-1) |
| Objetivo final 80/70 | **1/10** workspaces (`logistics`) |
| Controllers con spec | **0 de 25** (R-U-10/11) |
| `*.service.ts`/`*.consumer.ts` sin spec | **21 de 39** (R-U-18, R-COV-2) |
| Carpetas `domain/` | **0** → R-U-17/R-COV-2 N/A por estructura (IDs reservados intactos) |
| Integración / Contrato / E2E | **0 / 0 / 0** (deudas G-4, G-5, G-6) |
| Property-based / Mutación / Fuzz | sin `fast-check` / sin Stryker / sin fuzz (R-PB, R-MT, R-RB) |
| Lint | 0 errores / **47** warnings `no-explicit-any` |
| Audit `high` | exit 0 (R-QA-6) |
| Historial | **5 PRs** (#1–#5) `--rebase` · **0** merge commits de 15 |

## Qué cambió en esta auditoría

1. **`AUDIT.md` reescrito por completo** con lo medido hoy (snapshot de Core
   Engine; el anterior describía el proyecto origen: 758 tests, `backend/`,
   `pnpm`, Stryker, Playwright, karma — nada de eso existe aquí).
2. **`CHECKLIST.md` sin referencias heredadas**: el comando `pnpm --filter
   zkteco-attendance-backend run swagger:export` → deuda G-8 (no hay export en
   este repo); `prisma/seed.ts` → fixtures de seed genéricos; `karma.conf.js`
   → G-2/R-COV-5 marcados N/A; `R-EN-*` reescritos con las reglas reales de
   `ci/02` (`Node 20` + `npm ci --prefer-offline`, BD efímera exigible cuando
   exista suite que la necesite); `R-CD-*` marcados exigibles cuando exista
   `release.yml` (hoy solo hay `ci.yml`).
3. **`AUDIT-FRONTEND.md` borrado** — así lo preveía su propia fila en
   `_meta/README.md` ("candidato a borrar cuando se re-audite por primera vez
   este repo") y la entrada del árbol de `docs/rules/README.md`.
4. **`_meta/README.md`**: deuda declarada en su blockquote, cerrada.
5. **`AUDIT-HISTORY.md`**: nota de procedencia en la cabecera (las entradas
   2026-09-25..30 son del proyecto origen) y esta entrada.
6. **Nuevas deudas registradas en `AUDIT.md`** que antes no estaban en ningún
   lado de este repo: `R-CI-2` (ci.yml sin `concurrency`), `R-FL-3` (ningún
   setup fija `TZ`), contadores globales de controllers/services sin spec, y
   las capas `G-4/G-5/G-6/G-8` + robustez (R-PB/R-MT/R-RB) como deudas
   explícitas.

## Contexto de las Etapas 1–2 (cerradas antes de esta auditoría)

- **Etapa 1:** `ci/01..03`, `test/06` y `test/README` reescritos contra el
  `ci.yml` real (R-CI-1 enmendado a 4 jobs); gates G-1..G-8 con estado.
- **Etapa 2a:** ESLint real (`eslint.config.mjs`, alcance
  `packages/*/src/**/*.ts`, 0 errores) + job `lint` en CI (G-7 ampliado).
- **Etapa 2b:** suites unitarias de los 4 servicios que no tenían (98 tests) y
  **G-3 hecho efectivo**: `npm test -- --coverage` no transmitía el flag a
  `jest` (0 tablas de cobertura en cualquier run) y los 6 thresholds legacy
  80/80 nunca se habían cumplido (12–48 % medidos). Cerrado con cobertura por
  workspace en el script raíz, 10 tablas en CI y recalibración única al
  baseline medido (enmienda en `test/06`).

## Evidencia

- **Local (2026-10-01):** `npm test` exit 0 (175/23, 10 tablas de cobertura, 0
  `threshold not met`) · `npm run lint` exit 0 (0/47) · `npm run build` exit 0
  (0 TS) · `npm audit --audit-level=high` exit 0.
- **CI:** run `36886812250` (cabeza del PR #5) = 4/4 jobs success con 10
  tablas de cobertura en el log del job `test`; run `36887224095` sobre
  `main` = `f7282ca` → `completed success`.
- **Reglas:** el snapshot completo queda en [`AUDIT.md`](./AUDIT.md); este
  log solo registra el hecho de la auditoría (R-COV-3).
---

# AUDIT (histórico) — Segunda auditoría de Core Engine: re-auditoría del área `test/` (R-COV-3)

- **Fecha:** 2026-10-01
- **Disparador:** solicitud explícita de auditar el proyecto **en las reglas de
  testing** (R-COV-3). Primera re-auditoría completa desde la 1ª (Etapa 3):
  entre ambas medió el plan de deudas Etapas 4–5 y el modelo CD (D1–D4).
- **Comando:** `npm test` (10 workspaces con `--coverage`), `npm run lint`,
  `npm run build`, `npm audit --audit-level=high / moderate`, conteo manual de
  specs por capa, `gh pr list --state merged`, `git rev-list --merges
  --count origin/main`, `gh run list --branch {main,staging,develop}`,
  inspección de `ci.yml` y de `docs/rules/test/**`.
- **Estado global:** 🟡 **CUMPLE PARCIAL** (sin cambios frente a la 1ª) — gates
  G-1/G-3/G-7 ✅, G-2 N/A, G-4/G-5/G-6/G-8 ⏸; audit de dependencias a 0 en
  high **y moderate** (novedad de la Etapa 4).

## Métricas medidas (Core Engine, 2026-10-01)

| Métrica | Valor |
|---|---|
| Unit tests | **175 / 175** ✅ en **23 suites** / 10 workspaces (shared 8, api-gateway 6, orders 7, commissions 5, finance 44, market-intelligence 7, catalog 31, identity 24, stores 24, logistics 19) — **idéntico a la 1ª auditoría** |
| Cobertura (líneas/ramas) | idéntica al baseline: shared 9.48/5.18 · api-gateway 22.79/8.08 · orders 19.94/13.84 · commissions 12.24/5.08 · finance 48.25/41.82 · market-intelligence 15.42/2.20 · catalog 66.22/76.47 · identity 44.77/52.77 · stores 57.74/72.09 · logistics 81.11/92.59 |
| Gates `coverageThreshold` | **10/10** (R-COV-1) · objetivo final 80/70: **1/10** (`logistics`) |
| Controllers con spec | **0 de 25** (R-U-10/11) |
| `*.service.ts`/`*.consumer.ts` sin spec | **21 de 39** (R-U-18, R-COV-2) |
| Código puro de `shared` sin spec | **6 de 7** (solo `money.spec.ts`, R-U-17 tras Etapa 5) |
| Guards/pipes sin spec | `service-auth`, `validation.pipe` (R-U-15) |
| Integración / Contrato / E2E | 0 / 0 / 0 (G-4, G-5, G-6); OpenAPI sin export (G-8) |
| Property-based / Mutación / Fuzz | sin `fast-check` / sin Stryker / sin fuzz (R-PB, R-MT, R-RB) |
| Lint | 0 errores / 47 warnings |
| Audit | `high` exit 0 **y `moderate` exit 0** (Etapa 4) |
| Historial | **21 PRs** `--rebase` · **0** merge commits de 32 |

## Qué cambió entre la 1ª y esta auditoría (y qué no)

1. **No cambió nada del lado de testing**: desde la Etapa 5 no se tocó `src/`
   (todo fue reglas, docs y CI/CD), así que tests, cobertura, thresholds y los
   conteos de specs son los mismos de la 1ª auditoría.
2. **Cambió el entorno**: `ci.yml` ganó la rama `staging` en los gatillos
   (R-CI-1 enmendada, modelo CD D1) y las tres ramas de entorno están
   protegidas (R-GE-1). Los gates de testing verificados en esta auditoría no
   cambiaron de estado (3 ✅ · 1 N/A · 4 ⏸).
3. **Audit a cero también en moderates**: la Etapa 4 (`node-cron@4` + override
   `js-yaml@5.4.2`) dejó `npm audit --audit-level=moderate` en exit 0, además
   del high que ya exigía R-QA-6.
4. **Reglas adaptadas en la Etapa 5** (no deudas nuevas, sino reescritura a la
   realidad): R-U-17 apunta al código puro de `shared`, R-E-1..7 a flujos de
   comercio, R-MT a `identity`/`orders`/`commissions`/`finance`, R-RB a
   outbox/saga/broker, R-PB al dinero.
5. **Deudas sin resolver desde la 1ª auditoría** (registradas tal cual en
   `AUDIT.md` §Deudas 1–9): capas G-4/5/6/8, robustez (PB/MT/RB), cobertura
   objetivo, controllers/services/código puro sin spec, tooling JS fuera de
   ESLint, R-CI-2 (concurrencia), R-FL-3 (TZ), tsbuildinfo, 47 warns.

## Evidencia

- **Local (2026-10-01):** `npm test` exit 0 (175/23, 10 tablas, 0
  `threshold not met`) · `npm run lint` exit 0 (0/47) · `npm run build` exit 0
  (0 TS) · `npm audit --audit-level=high` y `--audit-level=moderate` exit 0.
- **CI:** run `36926380949` sobre `main` = `4c521a4` → `completed success`
  (4/4 jobs); ramas `staging`/`develop` con runs verdes en sus últimos SHA
  (verificado con `gh run list --branch …`).
- **Reglas:** el snapshot completo queda en [`AUDIT.md`](./AUDIT.md); este
  log solo registra el hecho de la auditoría (R-COV-3).

---

# AUDIT (histórico) — Tercera auditoría de Core Engine: salto de testing (Fase A/B) y deps al día (R-COV-3)

- **Fecha:** 2026-10-03
- **Disparador:** nueva auditoría solicitada (R-COV-3). La 2ª fue el 2026-10-01;
  entre ambas mediaron la **Fase A** (código puro + guards/pipes), la **Fase B**
  (controllers), la separación dev/prod del compose y la subida a **jest 30**.
- **Comando:** `npm test` (10 workspaces con `--coverage`), `npm run lint`,
  `npm run build`, `npm audit --audit-level=high / moderate`, conteo manual de
  specs por capa, `gh pr list --state merged`, `git rev-list --merges
  --count origin/main`, `gh run list --branch main`, inspección de `ci.yml` y de
  `docs/rules/test/**`.
- **Estado global:** 🟡 **CUMPLE PARCIAL** (sin cambio de color) — gates
  G-1/G-3/G-7 ✅, G-2 N/A, G-4/G-5/G-6/G-8 ⏸; pero **el testing se ha duplicado**
  (175 → 358 tests) y 4/10 workspaces ya alcanzan el objetivo 80/70. Audit de
  dependencias a 0 en high **y** moderate.

## Métricas medidas (Core Engine, 2026-10-03)

| Métrica | Valor |
|---|---|
| Unit tests | **358 / 358** ✅ en **55 suites** / 10 workspaces (shared 58, api-gateway 6, orders 31, commissions 15, finance 77, market-intelligence 19, catalog 46, identity 45, stores 37, logistics 24) |
| Cobertura (líneas/ramas) | shared 43.11/39.58 · api-gateway 22.79/12.82 · orders 44.20/23.16 · commissions 32.65/13.41 · finance 78.57/52.06 · market-intelligence 30.30/12.64 · catalog 96.00/83.50 · identity 90.04/76.69 · stores 90.84/85.48 · logistics 100.00/97.14 |
| Gates `coverageThreshold` | **10/10** (floor; 0 `threshold not met`) · objetivo final 80/70: **4/10** (catalog, identity, stores, logistics) |
| Controllers con spec | **24 de 25** (falta `field-service`, excepción R-QA-1) |
| `*.service.ts`/`*.consumer.ts` sin spec | **21 de 39** (R-U-18, R-COV-2) |
| Código puro de `shared` con spec | **7 de 7** (R-U-17) ✅ · guards/pipes (R-U-15) ✅ |
| Integración / Contrato / E2E | 0 / 0 / 0 (G-4, G-5, G-6); OpenAPI sin export (G-8) |
| Property-based / Mutación / Fuzz | sin `fast-check` / sin Stryker / sin fuzz (R-PB, R-MT, R-RB) |
| Lint | 0 errores / 47 warnings |
| Audit | `high` exit 0 **y `moderate` exit 0** (jest 30 cerró 29 `high` de devDeps) |
| Historial | **65 PRs** `--rebase` · **0** merge commits de 48 |

## Qué cambió entre la 2ª y esta auditoría

1. **Fase A (R-U-17/R-U-15):** `shared` puro pasó de 6/7 a **7/7** con spec y
   `service-auth`/`validation.pipe` quedaron testeados.
2. **Fase B (R-U-10/11):** controllers de **0/25 a 24/25**; los 10 workspaces con
   suite. `field-service` se mantiene **exceptuado (R-QA-1)** por no tener
   infraestructura de tests (no se creó jest solo para su controller).
3. **jest 29 → 30 (fix(deps), R-QA-6):** un aviso `high` nuevo y ajeno
   (`braces`/`micromatch`, ~29 paquetes del árbol de jest 29) rompía el Security
   Gate de TODOS los PRs. Se subió a jest 30 (su árbol no usa esos paquetes) con
   `ts-jest@29.4.14` (soporta `^29 || ^30`). Audit `high` **29 → 0**, 358 tests
   verdes sin tocar configs.
4. **Separación dev/prod del compose (ADR-15) + imagen:** `docker-compose.yml`
   base (solo `POSTGRES_PASSWORD`) + overlay de observabilidad opcional;
   `Dockerfile` a `node:20-alpine` y `npm ci`; sin `container_name` fijo
   (staging y produccion coexisten). No afecta a los gates de testing.
5. **Sin cambios de estado en los gates**: siguen 3 ✅ · 1 N/A · 4 ⏸ (G-1/G-3/G-7
   verdes; G-4/5/6/8 pendientes).

## Evidencia

- **Local (2026-10-03):** `npm test` exit 0 (358/55, 10 tablas, 0
  `threshold not met`) · `npm run lint` exit 0 (0/47) · `npm run build` exit 0
  (0 TS) · `npm audit --audit-level=high` y `--audit-level=moderate` exit 0.
- **CI:** run `37135717753` sobre `main` = `c090ef5` → `completed success`
  (4/4 jobs); ramas `staging`/`develop` con runs verdes en sus últimos SHA.
- **Reglas:** el snapshot completo queda en [`AUDIT.md`](./AUDIT.md); este
  log solo registra el hecho de la auditoría (R-COV-3).
---

# AUDIT — Primera auditoría de `ai_scraper_executor`: reescritura de `docs/rules/` contra el repo medido (R-COV-3)

- **Fecha:** 2026-10-05
- **Disparador:** no hubo una revisión programada; la auditoría **es** el trabajo de
  adaptar el árbol de reglas heredado al repo real. No hay entrada anterior de este
  repo, así que esta es su línea base.
- **Por qué hacía falta:** `docs/rules/` describe un e-commerce con microservicios
  (Core Engine), con Areas `gateway/` y `microservice/` que aquí no existen, DSL de
  un dominio de pedidos, Jest con `coverageThreshold` por workspace, Supabase,
  RabbitMQ, CQRS, Angular y despliegue Dockploy de tres entornos. Nada de eso es
  este repositorio. Sus cifras de auditoría (358 tests, 55 suites, 10 workspaces, 65
  PRs, 48 commits) también eran de otro proyecto.

## Qué se reescribió

| | Antes (heredado) | Ahora (medido) |
|---|---|---|
| Áreas | + `gateway/`, `microservice/`, `db/02-supabase.md` | `architecture`, `ai`, `security`, `scraping`, `data`, `db`, `observability`, `test`, `git`, `ci`, `cd` |
| Sufijos | `R-GW`, `R-MS`, `R-MI`, `R-SB` | **retirados, nunca reutilizar** |
| Runner | Jest 30, `*.spec.ts`, `coverageThreshold` | `node --test --test-concurrency=1`, `tests/*.test.mjs` |
| CI | 4 jobs (`security-gate` → `lint`/`test` → `build`) | **1 job** `build-test-lint` |
| Ramas | `develop` → `staging` → `main` con promoción | **`main` única**; promoción = deuda declarada |
| Despliegue | Dockploy, 3 environments, `infra/db/init/*.sql` | `docker-compose.yml` (6 servicios) + 2 Dockerfiles; migraciones en `prisma/migrations/` |
| Dominio | órdenes, comisiones, stock, dinero en centavos | scraping asistido por IA: 15 comandos DSL, SSRF, trazabilidad, presupuestos |

## Métricas medidas (2026-10-05)

| Métrica | Valor | Comando |
|---|---|---|
| Tests | **143 / 143 en verde, 36 suites** | `MONGODB_MOCK=1 npm test` |
| Ficheros de test | 27 en disco, 26 en `npm test` (el E2E va aparte) | `ls tests/*.test.mjs` |
| Lint | **0 errores, 20 warnings** | `npm run lint` |
| Build | exit 0 | `npm run build` |
| Auditoría de dependencias | **exit 1** con 14 vulnerabilidades (1 low, 5 moderate, **8 high**) | `npm audit --audit-level=high` y `--audit-level=moderate` |
| Paquetes | 12 + 2 apps | `ls packages` |
| Modelos Prisma / migraciones | 10 / 2 | `prisma/schema.prisma`, `ls prisma/migrations` |
| Git | 1 rama, 58 commits, **0 merge commits** | `git branch -a`, `git rev-list` |
| Workflow | 1 (`ci.yml`), 1 job | `.github/workflows/` |

## Gates

`G-1` ✅ · `G-2` **N/A** (sin frontend) · `G-7` ✅ · `G-3`, `G-4`, `G-5`, `G-6`, `G-8`,
`G-9` ⏸.

Total: **2 ✅ · 1 N/A · 6 ⏸** — frente a las 3 ✅ / 4 ⏸ de la última auditoría del
proyecto de origen, pero sobre un árbol de gates **distinto**: aquí `G-3` (cobertura)
no es un gate porque **no hay herramienta**, y se prefiere declararlo a fingir un
umbral medido que nadie ha medido.

## Hallazgos

1. 🔴 **`R-QA-6`/`R-SE-16` incumplidas**: `npm audit --audit-level=high` sale con
   código 1 (8 high) y no es un paso del pipeline. Arrastrado por el árbol de Nest
   (`@nestjs/platform-express` → `multer`, `qs`). Orden de ataque en
   [`AUDIT.md`](./AUDIT.md).
2. 🔴 **Sin cobertura**: no hay `c8`/`nyc` ni `--experimental-test-coverage` en el
   script. `G-3` no es activable sin medir el baseline (`R-COV-4`/`R-COV-5`).
3. 🔴 **Tres capas sin suite**: integración con almacén real, contrato de API y E2E
   como gate. El E2E existe como fichero y se ejecuta a mano.
4. 🟡 **`R-CI-2` sin cumplir**: `ci.yml` no declara grupo `concurrency`.
5. 🟡 **`scripts/` fuera del lint** (`eslint apps packages`).
6. 🟡 **Sin protección de rama en el remoto**: el workflow escucha `pull_request`,
   pero nada impide un push directo a `main`.
7. ⚪ **Divergencia entre documentos del repo**: `Readme.md` y `AGENTS.md` dicen
   «142 tests»; la medición da **143**. Se corrige el documento, no el test.

## Deudas que NO se cierran aquí

La promoción entre entornos (3 ramas / 3 entornos), el workflow de release por tag,
la exportación de OpenAPI, la suite de contrato, la de integración, el job E2E y las
herramientas de property-based/mutation testing quedan **registradas como deuda** con
sus IDs, no como reglas cumplidas. Se nombran en
[`AUDIT.md`](./AUDIT.md) y en el "Pendientes" del README de cada área.

## Evidencia

```bash
npm run build && npm run lint && MONGODB_MOCK=1 npm test   # verde
npm audit --audit-level=high                              # exit 1
git branch -a; git rev-list --count main; git rev-list --merges --count main
gh run list --limit 5                                     # evidencia de CI
```

- **CI:** no se cita un run concreto de esta auditoría para no crear el ciclo
  commit → run → commit. El criterio para marcar un gate ✅ es un run verde de CI
  (`R-COV-3`); `G-1` y `G-7` lo cumplen porque son los pasos del job que corre en
  cada push a `main`.

---

# AUDIT — Cierre de la puerta de seguridad (R-QA-6 / R-SE-16)

- **Fecha:** 2026-10-05 (mismo día, entrada separada para no reescribir la anterior)
- **Disparador:** la 1ª auditoría dejó `R-QA-6` en rojo (8 `high`, `npm audit` fuera
  de CI). Se decidió cerrarla antes de seguir.

## Qué cambió

- **`overrides` en el `package.json` raíz** para las transitivas vulnerables, sin
  forzar ningún major de Nest: `multer ^2.3.0`, `http-cache-semantics ^4.2.1`,
  `deepmerge-ts ^8.0.0`, `js-yaml ^4.3.2`, `lodash ^4.18.1`, `body-parser ^1.20.8`,
  `qs ^6.16.0`, `file-type ^21.3.4`. `package-lock.json` regenerado y verificado con
  `npm ci --dry-run`.
- **Paso `Security audit`** (`npm audit --audit-level=high`) añadido al job
  `build-test-lint`, justo después de `Install` para fallar rápido.
- Decisión registrada como **ADR-16** en [`../../decisiones.md`](../../decisiones.md).

## Métricas medidas

| Métrica | Antes | Ahora |
|---|---|---|
| `npm audit --audit-level=high` | exit 1 (8 high) | **exit 0** |
| `npm audit --audit-level=moderate` | exit 1 | exit 1 (**1 moderate**: `@nestjs/core <=11.1.17`) |
| Verificación de cierre | build/lint/test verdes | build/lint/test **verdes** (143/143) |
| Prisma con `deepmerge-ts@8` | 6.19.3 | `prisma validate` y `generate` OK |

## Deuda residual

`@nestjs/core <=11.1.17` (moderate) solo se cierra subiendo Nest de major
(10 → 11/12), que además alinearía con `@nestjs/mongoose@12`. No se fuerza con
`overrides` porque es un salto de versión mayor con migración propia. Queda
declarado en [`AUDIT.md`](./AUDIT.md).

---

# AUDIT — Activación de la cobertura (G-3)

- **Fecha:** 2026-10-05
- **Disparador:** `G-3` estaba `⏸` (sin herramienta). Se cierra sin añadir
  dependencias.

## Qué cambió

- El script `test` de `package.json` incorpora `--experimental-test-coverage` y los
  umbrales `--test-coverage-lines=70 --test-coverage-branches=72
  --test-coverage-functions=67`, con el alcance
  `--test-coverage-include="packages/*/dist/**/*.js"` y `"apps/*/dist/**/*.js"` y
  exclusiones `**/*.module.js`, `**/main.js`, `**/dto/**`.
- No se añadió `c8`/`nyc`: la cobertura es la **nativa de Node ≥22**, que falla el run
  si no se alcanza el umbral.
- Decisión registrada como **ADR-17**; reglas `R-COV-4` (alcance) y `R-COV-5`
  (baseline/ratchet) actualizadas.

## Baseline medido (2 ejecuciones, estable)

| Entorno | Líneas | Ramas | Funciones |
|---|---|---|---|
| Sin `MONGODB_MOCK` (dev) | 71.59 | 73.69 | 68.90 |
| Con `MONGODB_MOCK=1` (CI) | 71.83 | 73.83 | 68.78 |
| **Umbral fijado (base − 1)** | **70** | **72** | **67** |

## Gates

`G-3` pasa a ✅. Total: **3 ✅ · 1 N/A · 5 ⏸**.

## Nota de alcance

Node solo reporta ficheros **cargados** por la suite; un fichero nunca importado no
arrastra el porcentaje. La regla `R-COV-2` sigue cubriendo "lógica sin test", que el
gate no puede ver. Documentado en `R-COV-4`.

---

# AUDIT — Endurecimiento de CI: concurrencia y G-9

- **Fecha:** 2026-10-05
- **Disparador:** dos deudas de configuración de CI (`R-CI-2` y `G-9`).

## Qué cambió

- `ci.yml` declara **`concurrency`** por ref con `cancel-in-progress: true`
  (`R-CI-2`): un push nuevo cancela el run anterior de la misma rama.
- Se añade un **servicio `postgres:16-alpine`** de un solo job (`R-EN-2`) y los pasos
  `Prisma schema valid` (`npx prisma validate`) y `Migrations have no drift`
  (`prisma migrate deploy` + `prisma migrate diff --from-url … --to-schema-datamodel
  … --exit-code`). Un cambio de `schema.prisma` sin su migración devuelve **exit 2**
  y falla el job (`G-9`).
- Verificado en local con el Postgres del `docker-compose.yml`: sin deriva → exit 0
  ("No difference detected"); con un modelo extra en el schema → exit 2.

## Gates

`G-9` pasa a ✅. Total: **4 ✅ · 1 N/A · 4 ⏸**.

## Deuda que queda

`R-EN-3` (artifacts) sigue sin uso; `G-4`/`G-5`/`G-6`/`G-8` siguen pendientes. El
servicio Postgres de CI se ampliará a Mongo/Redis cuando exista la suite de
integración (`G-4`).

---

# AUDIT — Nest 12, eslint 10 y retirada de --legacy-peer-deps (ADR-18)

- **Fecha:** 2026-10-05
- **Disparador:** cerrar la cadena de dependencias que quedaba tras ADR-16.

## Qué cambió

- `apps/api` sube a **Nest 12** (`@nestjs/common`, `@nestjs/core`,
  `@nestjs/platform-express` `^12.1.2`, `@nestjs/swagger` `^12.0.2`); la raíz sube
  `eslint` a `^10.12.0` (cuadra con `@eslint/js@10`).
- Los peers alinean con `@nestjs/mongoose@12` y se **retira `--legacy-peer-deps`** de
  `ci.yml` y de los dos Dockerfiles: `npm ci --ignore-scripts` a secas.
- Nest 12 trae **Express 5** (routing `path-to-regexp` 8): la API actual migra sin
  cambios (solo controllers Nest).

## Métricas

| Métrica | Antes | Ahora |
|---|---|---|
| `npm audit` | 1 moderate (`@nestjs/core`) | **0 vulnerabilidades** |
| Instalación CI | `npm ci --ignore-scripts --legacy-peer-deps` | `npm ci --ignore-scripts` |
| Build / lint / test | verdes | **verdes (143/143)** |

## Deuda que queda

`R-EN-3` (artifacts), `G-4`/`G-5`/`G-6`/`G-8`, `scripts/` fuera del lint, protección de
rama y robustez. El `overrides` de transitivas sigue siendo deuda viva (revisar al
actualizar dependencias).

---

# AUDIT — Front C: lint de scripts, warnings a cero, G-8 y artifacts

- **Fecha:** 2026-10-05

## Qué cambió

- **Lint**: `eslint apps packages scripts` (antes sin `scripts/`), con globals de
  Node para los `.mjs`. Corregidas las findings reales (`no-useless-assignment`,
  `preserve-caught-error`) y los `any`/variables sin usar con tipos estructurales.
  Resultado: **0 errores / 0 warnings**.
- **G-8 (OpenAPI)**: `docs/openapi.json` versionada; `scripts/check-openapi.mjs` la
  exporta/compara arrancando la API y CI ejecuta `npm run openapi:check`
  (paso `OpenAPI spec in sync`).
- **R-EN-3 (artifacts)**: el reporter JUnit de Node escribe `test-results.xml`,
  subido como artifact en todos los runs (`if: always()`).
- **Runtime Nest 12/Express 5**: adaptador `ExpressAdapter` explícito y comodín
  `*url` (commit propio `fix(api): ...`).

## Gates

`G-8` pasa a ✅. Total: **5 ✅ · 1 N/A · 3 ⏸**.

## Detalle que deja constancia

La regresión de arranque de Nest 12/Express 5 **no** la detectó la suite unitaria
(no levanta la app): la detectó el arrancar la API a mano para exportar la spec. Es
evidencia directa de por qué `G-4`/`G-6` siguen abiertos.

---

# AUDIT — Front E: property-based testing real; mutation diferido (ADR-20)

- **Fecha:** 2026-10-05

## Qué cambió

- **`fast-check`** instalado; `tests/property.test.mjs` con 6 propiedades que corren
  dentro de `npm test` (149 tests / 37 suites): rango e idempotencia de
  `normalizeJobLimits`, `0` que no desactiva, idempotencia de `normalizeDomain`,
  dominio raíz/subdominios de `isAllowedHost`, y `type` siempre del DSL en
  `normalizeRawCommand`/`normalizeRawPlan`.
- **Dos defectos reales encontrados y corregidos** (`R-REG-1`):
  1. `normalizeJobLimits({maxRequests: 5e-324})` → `0` (fuera de `[1, HARD]` y no
     idempotente). Fix: `Math.max(1, Math.min(Math.floor(raw), HARD))`.
  2. `normalizeRawCommand({type:'_ proto _'})` (y `__proto__`/`constructor`) resolvía
     contra el prototipo del mapa de alias y colaba un comando inexistente. Fix:
     `Object.hasOwn(ALIASES, lower)`.
- **Mutation testing diferido a propósito** (ADR-20): Stryker 10 solo trae runners
  jest/vitest/tap y los tests cargan `dist` con `node --test`; se reevalúa cuando
  exista una suite con runner soportado.

## Cobertura

El baseline se mantiene por encima del umbral: 71.83 / 74.43 / 68.78 (ramas suben al
ejercitar más caminos). Sin subir los umbrales todavía (el ratchet es +5/release,
`R-COV-5`).

---

# AUDIT — Front B: contrato (G-5), integración (G-4) y E2E de release (G-6)

- **Fecha:** 2026-10-05

## Qué cambió

- **`G-5` contrato**: `tests/contract.test.mjs` arranca la API compilada (memoria,
  sin infra) y valida formas de `/api/v1/**` (8 tests). Es el paso `Contract` de
  `build-test-lint`.
- **`G-4` integración**: `tests/integration.test.mjs` con Postgres/Mongo/Redis reales
  (4 tests: lifecycle del job, idempotencia, persistencia y Mongo). Job `integration`
  con servicios efímeros. Se salta sin infra para no romper `npm test`.
- **`G-6` E2E**: workflow `e2e.yml` en `release`/`workflow_dispatch` con servicios,
  Chromium y `OPENROUTER_API_KEY`. `test:e2e` usa `--env-file-if-exists`.
- **Helper** `scripts/api-server.mjs` para arrancar la API en tests.

## Tercer defecto de las propiedades

Al re-ejecutar la suite apareció un tercer defecto real en el alcance de `R-PB`:
`normalizeDomain` no era idempotente (`'; /'` → `'; '` → `';'`, por un espacio
colgando). Fix: `.trim()` en la forma canónica. Corregido con `R-REG-1`.

## Gates

`G-4`, `G-5` y `G-6` pasan a ✅. Total: **8 ✅ · 1 N/A · 0 ⏸**. Los tres están
verificados en local; la evidencia de run verde de CI llega con el primer push
(`R-COV-3`).

---

# AUDIT — 2ª auditoría: áreas documentation/ y ai-contributions/, y sincronización con el remoto

- **Fecha:** 2026-10-06
- **Disparador:** el usuario añadió dos borradores (`docs/rules/documentation/` y
  `docs/rules/ai/01-contribuciones.md`) escritos todavía para otro proyecto. Se
  integraron respetando la metodología, y se purgó el estado que quedó obsoleto
  tras publicar la 1ª auditoría por PR.

## Qué cambió

- **Área `documentation/` (`R-DO`, 1–7)**: adaptada a este repo (sin «Core Engine»,
  sin microservicios/Gateway/RabbitMQ), registrada en el índice raíz, con
  `.env.production.example` creado (hace ciertas `R-DO-3` y `R-DS-1`) y `R-DO-6`
  alineada con `R-C-12`/`G-8`.
- **Área `ai-contributions/` (`R-AC`, 1–6)**: el borrador `ai/01-contribuciones.md`
  colisionaba con `01-dsl.md`, usaba el sufijo `R-IA` (anagrama de `R-AI`) y citaba
  el ID retirado `R-GW-4`. Se movió a un área propia, con sufijo `R-AC`, sin
  referencias al proyecto origen y con el tooling del harness remitido a `AGENTS.md`.
- **Estado sincronizado con el remoto** en `git/`, `ci/`, `test/` y `_meta/CHECKLIST.md`:
  68 commits, `docs/` trackeado, 2 jobs + `e2e.yml`, `R-EN-2/3/4` ejecutadas,
  `R-I-12`/`R-C-12` con suite real, `--env-file-if-exists`.

## Gates

Siguen **8 ✅ · 1 N/A · 0 ⏸**, ahora con evidencia de run verde real: PR #1 (checks
en la cabeza) y `main` `d891389` (run `37361504637`, ambos jobs `success`).

## Deuda nueva declarada

`R-DO-1`: 12 packages + 2 apps sin `README.md`. Registrada en `AUDIT.md`.

---

# AUDIT — Cierre de R-DO-1 (READMEs) y subida de actions a v7

- **Fecha:** 2026-10-06
- **Disparador:** la 2ª auditoría dejó como deuda `R-DO-1` (14 READMEs) y el log de CI
  avisaba de la deprecación de Node 20 en `actions/checkout@v4`/`setup-node@v4`.

## Qué cambió

- **`R-DO-1` cumplido**: `README.md` en los 12 packages (`core`, `security`,
  `observability`, `commands`, `crawler`, `execution-engine`, `ai`, `ai-providers`,
  `mongodb`, `redis`, `storage`, `queue`) y en las 2 apps (`api`, `worker`). Cada uno
  describe responsabilidad, capa, dependencias exclusivas, superficie pública y
  comandos, citando las reglas que gobiernan.
- **Actions a `v7`** (`checkout`, `setup-node`, `upload-artifact`), todas sobre
  **Node 24** → desaparece el aviso de deprecación de Node 20. La política queda en
  `R-EN-1`.

## Estado

- Deuda `R-DO-1` cerrada; `documentation/` pasa a 🟢.
- Gates sin cambios (**8 ✅ · 1 N/A · 0 ⏸**).

---

# AUDIT — Revisión de overrides (de 8 a 1) y gatillo manual de CI

- **Fecha:** 2026-10-06

## Qué cambió

- **`overrides` revisados** (ADR-16): eliminados 7 de 8. Con el árbol sin overrides,
  la única vulnerabilidad `high` que reaparecía era `deepmerge-ts <8.0.0` (vía
  `@prisma/config`). Tras Nest 12/eslint 10, `multer`, `qs`, `body-parser`,
  `http-cache-semantics`, `js-yaml`, `lodash` y `file-type` ya llegan parcheados por
  sus padres. El bloque queda en `{ "deepmerge-ts": "^8.0.0" }`. `npm audit` sigue en 0
  y build/lint/test/contrato/OpenAPI en verde.
- **Gatillo manual de CI** (`workflow_dispatch`, `R-CI-1`): mitigación del evento
  `pull_request` que este remoto no siempre entrega (documentado en `ci/README.md`).

## Estado

- Gates sin cambios (**8 ✅ · 1 N/A · 0 ⏸**); deuda de overrides reducida y revisada.

---

# AUDIT — Completitud del DSL (R-AI-2, R-U-12)

- **Fecha:** 2026-10-06

## Qué cambió

- Nuevo `tests/dsl-completeness.test.mjs` dentro de `npm test` (153 tests / 38 suites):
  comprueba que el enum tiene exactamente **15** comandos, que **cada** `type`
  sobrevive al normalizador sin mutar, que **cada** `type` aparece en el `DSL_SPEC`
  que se declara al modelo, y que un `type` inventado se descarta.
- Cierra el pendiente del área `ai/` («no hay test de que todos los `type` tengan
  normalizador y prompt») y la deuda `R-U-12` de esa capa.

## Estado

- Gates sin cambios (**8 ✅ · 1 N/A · 0 ⏸**); cobertura 71.83 / 74.62 / 68.94.

---

# AUDIT — Índices de base de datos (R-DB-4, R-DB-5)

- **Fecha:** 2026-10-06

## Qué cambió

- El esquema no declaraba **ningún** índice salvo `User.email` (el email es único).
- Migración `20261006153221_add_composite_indexes` (generada con `prisma migrate dev
  --create-only` sobre Postgres real, `R-DB-1`): 11 índices.
  - **FK**: `jobId` en `ScrapingPlan`, `Command`, `Page`, `Result`, `JobError`,
    `AIInteraction`; `sessionId` en `Job` y `SessionMessage`; `userId` (compuesto).
  - **Consulta**: `Job(status, createdAt)` (filtro+orden de `listJobs`),
    `Job(userId, createdAt)`, `Session(domain, updatedAt)`.
- Verificado: `migrate deploy` OK y `migrate diff --exit-code` = «No difference detected».

## Estado

- Gates sin cambios (**8 ✅ · 1 N/A · 0 ⏸**); migraciones **3**. Cierra el pendiente
  de índices del área `db/`.

---

# AUDIT — Reevaluación de mutation testing (R-MT-1, ADR-20)

- **Fecha:** 2026-10-06
- **Disparador:** ADR-20 decía «se reevalúa cuando exista una suite con runner
  soportado (p. ej. al cerrar G-4/G-5)». `G-4`/`G-5` ya están cerrados.

## Resultado

**Sigue diferido.** Cerrar capas de test **no cambia el runner**, que continúa siendo
`node --test` (cargando `dist`), no soportado por Stryker 10 (solo jest/vitest/tap). El
disparador real es **adoptar un runner soportado** (un framework), algo que ADR-03
evita a propósito y que exigiría enmendarlo. Se corrige el enunciado del disparador en
`R-MT-1` y ADR-20, y se anota que la completitud del DSL (`tests/dsl-completeness.test.mjs`)
cubre parte del riesgo.

## Estado

- Gates sin cambios (**8 ✅ · 1 N/A · 0 ⏸**).

---

# AUDIT — Release por tag (R-CD-1..8, ADR-22)

- **Fecha:** 2026-10-06

## Qué cambió

- Nuevo `.github/workflows/release.yml`: push de tag `v*.*.*` o `workflow_dispatch`
  con `dry_run` por defecto. Job `validate` (formato de tag + procedencia: commit en
  `main` y run de `ci` verde en ese SHA) y job `images` (matriz api/worker: build
  único, etiquetas OCI + semver + `sha-<corto>` + `latest` solo no-prerelease, push a
  GHCR, digest en el resumen). Implementa `R-CD-1..4`, `R-CD-7` y `R-CD-8`.
- Documentado como tercer workflow aceptado por `R-CI-4`; `cd/README.md` y
  `cd/01-despliegue.md` dejan de decir «no existe».
- ADR-22 registra la decisión; se restaura en `decisiones.md` la tabla de deudas de
  ADR (se había perdido en una edición previa).

## Proceso

El tag se corta **después** de que el E2E (`G-6`) esté verde; el release asume esa
puerta y no la reejecuta. `R-CD-5` (migraciones) sigue en el despliegue y `R-CD-6`
en el merge verificado a `main` (no hay entornos separados).

## Estado

- Gates sin cambios (**8 ✅ · 1 N/A · 0 ⏸**); workflows **3**.

---

# AUDIT — Detección de tests intermitentes (R-FL-1)

- **Fecha:** 2026-10-06

## Qué cambió

- Nuevo `scripts/repeat-tests.mjs` y comando `npm run test:repeat -- <n>`: repite la
  suite unitaria `n` veces (por defecto 5) y falla si alguna iteración contrasta con
  las demás. Node 22 no trae `--test-rerun-failures`, así que la detección se hace por
  repetición.
- **No es un gate de PR** (es lento, ~25 s por iteración): se usa antes de un release o
  al investigar un fallo esporádico. `R-FL-1` deja de estar ⏸ en el cross-ref de CI.

## Estado

- Gates sin cambios (**8 ✅ · 1 N/A · 0 ⏸**).

---

# AUDIT — Retención de artefactos de job (R-DI-8)

- **Fecha:** 2026-10-06

## Qué cambió

- Política de retención **definida** (`R-DI-8`): se conservan `Job`, `Result`,
  `JobError` y `Session`/`SessionMessage`; se purgan `Page`, `Command` y
  `AIInteraction` más antiguos que `RETENTION_ARTIFACT_DAYS` (30 por defecto).
- `scripts/retention.mjs` + `npm run retention:prune`: borrado **explícito** (una
  transacción, registra lo que borra), no una cascada automática. Probado contra
  Postgres real (0 filas con datos recientes).
- `RETENTION_ARTIFACT_DAYS` añadida a `.env.example` y `.env.production.example`
  (`R-DO-3`).

## Estado

- Gates sin cambios (**8 ✅ · 1 N/A · 0 ⏸**). Cierra el pendiente de retención de
  `data/` y `db/`.

---

# AUDIT — Separación opt-in de Redis para la cola (R-RD-1, ADR-23)

- **Fecha:** 2026-10-06

## Qué cambió

- `queueRedisUrl()` en `libs/infrastructure/queue`: usa `QUEUE_REDIS_URL` si está definida y no
  vacía, si no `REDIS_URL`. La usan `createJobQueue` (API) y el consumidor BullMQ del
  worker.
- `docker-compose.yml`: servicio `redis-queue` bajo el perfil `split-redis` (no arranca
  en el `up` por defecto) y `QUEUE_REDIS_URL` en `api`/`worker`
  (`${QUEUE_REDIS_URL:-redis://redis:6379}`).
- `QUEUE_REDIS_URL` en `.env.example` (vacío) y `.env.production.example` (instancia
  separada recomendada).
- `R-RD-1` reescrita: por defecto prefijos de clave; en producción se recomienda la
  instancia separada.

## Estado

- Gates sin cambios (**8 ✅ · 1 N/A · 0 ⏸**); build/lint/153 tests en verde.

---

# AUDIT — Stack de observabilidad provisionado (R-TM-*, ADR-24)

- **Fecha:** 2026-10-06

## Qué cambió

- `infra/observability/prometheus.yml` (scrape de `/api/v1/metrics/prometheus`) y
  `infra/observability/grafana/` (datasource + dashboard `scraper-red` con las métricas
  reales `scraper_jobs_*`, `scraper_items_extracted_total`, `scraper_pending_jobs`,
  `scraper_queue_depth`, `scraper_distributed_*`, `scraper_uptime_seconds`).
- `docker-compose.observability.yml`: override con Prometheus + Grafana; arranca la API
  con `API_KEYS` vacío para el scrape local.
- `observability/README.md` deja de declarar «no hay Grafana provisionado».

## Deuda que permanece

Las **reglas de alerta** (`R-TM-5`/`R-TM-9`) siguen siendo un contrato no provisionado;
el stack es local, no de producción (allí el scrape debe llevar `x-api-key`, `R-TM-7`).

## Estado

- Gates sin cambios (**8 ✅ · 1 N/A · 0 ⏸**); `docker compose … config` válido.

---

# AUDIT — Reglas de alerta provisionadas (R-TM-5, R-TM-9)

- **Fecha:** 2026-10-06

## Qué cambió

- Nueva métrica `scraper_jobs_dead_total`: el worker la incrementa al mover un job a la
  cola de muertos (`apps/worker/src/main.ts`), habilitando la alerta «por crecimiento,
  no por existir» de `R-TM-5`.
- `infra/observability/alerts.yml`: reglas `ScraperDeadLetterGrowing`,
  `ScraperJobFailuresHigh` y `ScraperQueueBacklog`, cada una con la acción a tomar en su
  descripción (`R-TM-9`). `prometheus.yml` las carga con `rule_files`.
- **Alertmanager** (envío/notificación) sigue sin provisionarse: las alertas se ven en
  Prometheus/Grafana.

## Estado

- Gates sin cambios (**8 ✅ · 1 N/A · 0 ⏸**); build/lint/153 tests verdes.

---

# AUDIT — Instrumentación HTTP RED automática (R-TM-3, R-TM-4)

- **Fecha:** 2026-10-06
- **Disparador:** `observability/README.md` declaraba que las métricas RED no eran
  automáticas: se medían por `withSpan` solo en los puntos marcados.

## Qué cambió

- `apps/api/src/jobs/http-metrics.interceptor.ts`: interceptor global que, en cada
  request HTTP, incrementa `scraper_http_requests_total{method,status,route}` y
  `scraper_http_request_duration_ms_total{...}` (avg = `rate(total)/rate(requests)`).
- Etiquetas de baja cardinalidad: `method` (enum HTTP) y `route` (patrón de Nest,
  nunca la URL con IDs). `R-TM-3` amplía las etiquetas aceptadas; `R-TM-4` documenta la
  instrumentación automática.
- `tests/contract.test.mjs`: nuevo test que comprueba que las dos métricas aparecen en
  `/api/v1/metrics/prometheus` (9/9).

## Estado

- Gates sin cambios (**8 ✅ · 1 N/A · 0 ⏸**); 153 tests + 9 de contrato + 4 de
  integración en verde.

---

# AUDIT — Integración reforzada (R-I-2, R-I-4, R-I-6)

- **Fecha:** 2026-10-06
- **Disparador:** la suite de integración (G-4) tenía 4 tests; faltaban filtros,
  paginación y mass-assignment.

## Qué cambió

- `tests/integration.test.mjs` pasa a **7 tests** con almacenes reales:
  - `R-I-4`: `POST /jobs` sin API key → `401`.
  - `R-I-6`: el `ValidationPipe` descarta `status`/`userId` inyectados (el job no sale
    `COMPLETED` ni con el `userId` ajeno).
  - `R-I-2`: filtro por `status` correcto (todos los items encajan) y `limit=1`
    devuelve exactamente 1 item con `nextCursor`, conservando el filtro.

## Estado

- Gates sin cambios (**8 ✅ · 1 N/A · 0 ⏸**); contrato 9/9, integración 7/7.

---

# AUDIT — Puertos del compose configurables (despliegue Dokploy)

- **Fecha:** 2026-10-06
- **Disparador:** un deploy en Dokploy falló al arrancar `api`:
  `Bind for 0.0.0.0:3000 failed: port is already allocated`. El compose publicaba
  puertos fijos en el host y el `3000` ya estaba asignado por otro servicio.

## Qué cambió

- `docker-compose.yml`: los puertos publicados pasan a ser configurables con default
  local — `API_PORT` (3000), `POSTGRES_PORT` (5432), `MONGODB_PORT` (27017),
  `REDIS_PORT` (6379). El lado del contenedor no cambia.
- `.env.example` / `.env.production.example`: nuevas variables documentadas; en
  producción son `<puerto-host-libre>`.
- `cd/02-entornos.md`: sección «Sobre los puertos publicados»; `cd/README.md` y ADR-25
  registran la decisión.

## Verificación

`docker compose config` con defaults → 3000/27017/5432/6379; con overrides →
3010/37017/55432/36379.

---

# AUDIT — Sincronización de consistencia documental

- **Fecha:** 2026-10-08
- **Disparador:** revisión de consistencia de la documentación: varias reglas y
  snapshots describían un estado anterior (checks de CI, `release.yml`, export de
  OpenAPI, cifras de tests) que ya no era el real.

## Qué cambió

- `rules/git/04-pr.md` (`R-PR-6`/`R-PR-8`): los checks de PR pasan a describir la
  realidad de `ci.yml` — dos jobs (`build-test-lint`: `G-1`, `G-3`, `G-5`, `G-7`,
  `G-8`, `G-9`, `R-QA-6`; `integration`: `G-4`) y el E2E (`G-6`) como check **solo de
  release** (`R-CI-4`), no de PR.
- `dockploy-setup.md`: §0 (workflow `ci` completo, no solo `build-test-lint`), §6
  (stack local Prometheus/Grafana, ADR-24; Alertmanager pendiente) y §8 (se retiran
  `release.yml` y el export de OpenAPI, que ya existen; se dejan como deuda el
  despliegue por digest y el envío de alertas).
- `_meta/AUDIT.md`: se retira `R-DO-1` de las deudas (cumplido, 14/14) y se
  sincronizan las cifras internas — unit **153/38**, contrato **9**, integración
  **7**, `G-1` 153/153, `G-4` 7/7, `G-5` 9/9, **88 commits**.
- `README.md` / `AGENTS.md`: recuento de tests a **153** (y lista de suites completa,
  +`dsl-completeness`, +`property`).
- `_meta/CHECKLIST.md`: aclarado que `G-4` es **integración** (no contrato) en la
  nota de la sección de integración/E2E.

## Verificación

`npm run build` (exit 0), `npm run lint` (0/0), `MONGODB_MOCK=1 npm test`
(**153/153**, 38 suites), `npm run test:contract` (**9/9**),
`npm run test:integration` con Docker (**7/7**), `npm run openapi:check`,
`npm audit --audit-level=high` (**0**). CI en `main` (`d8003e9`): `completed success`.

## Hallazgos fuera de alcance (portabilidad Windows)

- **Cobertura de funciones**: en Windows la cobertura medida localmente queda por
  debajo del umbral (67) y `npm test` sale con código 1 (dos corridas:
  **73.49/74.48/61.67** sin almacenes y **74.56/74.85/62.50** con Postgres/Mongo/Redis
  levantados — la disponibilidad de los almacenes cambia qué ramas se ejecutan). En CI
  (Linux, Node 22) el gate está verde; la diferencia es de plataforma, no de código.
  El gate autoritativo es CI (`R-COV-3`).
- **`openapi:check`**: `scripts/check-openapi.mjs` compara el fichero byte a byte;
  con el checkout CRLF de Windows falla aunque el fichero versionado (LF) sea
  correcto. En Linux pasa.

---

# AUDIT — Auditoría del área `ci/` y corrección de `R-CI-2`

- **Fecha:** 2026-10-08
- **Disparador:** auditoría solicitada del área `ci/` (`R-CI-1..6`, `R-EN-1..5`),
  respetando el resto de reglas (`R-AC-1`, `R-AC-6`, `R-COV-3`).
- **Base:** `origin/main` (workflows y reglas idénticos al working tree). El árbol de
  trabajo local estaba sucio (WIP no commitear en `apps/*`, `packages/*`, `engines`
  y `.nvmrc`), así que la medición se hace contra la base publicada, no contra el WIP.
- **Comando:** lectura de `docs/rules/ci/`, `grep` de los workflows (`node-version`,
  `npm ci`, `concurrency`, `paths`, `continue-on-error`, `uses: actions/`), `node -v`,
  `git show origin/main:package.json`, `docker-compose.yml`, `gh run list`.

## Resultado

`R-CI-1..6` y `R-EN-1..5` → **11/11 ✅** tras corregir una desviación.

### Desviación corregida (`R-CI-2`)

- `e2e.yml` declaraba `concurrency` con **`cancel-in-progress: false`**.
- `release.yml` **no declaraba `concurrency`** en absoluto → dos ejecuciones podían
  solaparse publicando imágenes (riesgo para `R-CD-1..4`).
- `R-CI-2` exige un grupo por ref con `cancel-in-progress: true` en cada workflow, y
  relajarlo «exige enmienda explícita», que no existía. Fix en el mismo cambio: grupo
  `release-${{ github.ref }}` en `release.yml` y `cancel-in-progress: true` en
  `e2e.yml` y `release.yml` (`ci.yml` ya cumplía).

## Otros hallazgos (fuera del área, sin cambio)

- `AGENTS.md` describía «Node 22 (`.nvmrc` + `engines`)» a partir del WIP local; en la
  base publicada `engines` es `>=20` y `.nvmrc` no existe. Se alinea a «Node ≥20 (CI e
  imágenes usan 22)», que es cierto en ambos estados.
- `e2e.yml` fija `TEST_URL` a `negocio360oficial.com` mientras el fichero se llama
  `e2e-sevasa.test.mjs` y los docs citan sevasa: desalineación de nombre, no de regla
  (`R-E-11` se cumple: `TEST_URL` sale de variable). Se registra, no se toca.

## Verificación

- `grep -rn "concurrency" .github/workflows/` → los 3 workflows con grupo y
  `cancel-in-progress: true`.
- `gh run list --limit 5` → runs `success` (evidencia de `R-CI-6`); el de la rama es
  requisito de `R-PR-6`.
- El cambio es de workflows y documentación; no altera `src/` ni tests. La verificación
  de cierre (`build`/`lint`/`test`) la ejecuta la CI del PR (`R-COV-3`).

---

# AUDIT — Nueva regla R-DO-8 (sincronización documental)

- **Fecha:** 2026-10-08
- **Disparador:** la revisión de consistencia documental destapó deriva entre READMEs
  y código (recuentos de tests, `release.yml` negado en el guion, checks de `R-PR-6`
  que ya existían). El área `documentation/` cubría casos concretos pero ninguna regla
  obligaba a sincronizar el README de un módulo al cambiar su lógica.

## Qué cambió

- `documentation/01-reglas-documentacion.md`: nueva regla **`R-DO-8`** — todo cambio de
  lógica en `apps/*`/`packages/*` viene con el README de su módulo actualizado en el
  mismo PR; si no altera nada documentado, el PR lo declara en el `CHECKLIST`. Se añade
  el comando de verificación.
- `documentation/README.md`: mapa de IDs `R-DO` a **1–8** y cross-ref al `CHECKLIST`.
- `_meta/CHECKLIST.md`: ítem `R-DO-8` en la sección 13 (documentación).
- `decisiones.md`: **ADR-26** registra la decisión.

## Estado

- Gates sin cambios (**8 ✅ · 1 N/A · 0 ⏸**). Es una regla de proceso: su evidencia es
  el `CHECKLIST` marcado del PR (sin gate mecánico posible); `G-8` (OpenAPI) y `G-9`
  (migraciones) siguen cubriendo lo automatizable.

---

# AUDIT — Objetivo arquitectura hexagonal (R-HX-1..9)

- **Fecha:** 2026-10-09
- **Disparador:** decisión de elevar el proyecto a **arquitectura hexagonal (puertos y
  adaptadores) por bounded contexts**, empezando —según lo acordado— por **documentación
  y reglas** que fijen el rumbo, sin mover código todavía.

## Qué cambió

- `decisiones.md`: **ADR-27** (modelo hexagonal canónico `domain`/`application`/
  `infrastructure`/`shared` + `apps/*`, sustituye la vista de 5 capas), **ADR-28**
  (gobernanza con npm workspaces + verificador de fronteras sin dependencias, sin
  Nx/Turborepo; `eslint-plugin-boundaries` se descartó por vulnerabilidades — ver F0),
  **ADR-29** (Vitest como runner objetivo; **sustituye ADR-03 y ADR-17**), **ADR-30**
  (migración strangler). ADR-03 y ADR-17 quedan marcados como sustituidos.
- Nuevo `rules/architecture/03-arquitectura-hexagonal.md` con `R-HX-1..9` (capas,
  dirección de dependencia, puertos/adaptadores, enforcement, composition root,
  mapeo por contexto, strangler).
- `rules/architecture/README.md`: modelo canónico + mapa `R-HX` + cross-refs + pendientes.
- `rules/architecture/01-arquitectura.md`: **`R-AR-2` enmendada** (ID conservado) para
  delegar el modelo de capas en `R-HX-1`.
- `rules/architecture/02-naming.md`: **`R-NC-10`** (estructura interna de una lib) y
  rango `R-NC` a 1–10.
- `rules/_meta/CHECKLIST.md`: sección **14 (arquitectura hexagonal)**.
- `rules/_meta/AUDIT.md`: fila «Arquitectura hexagonal (`R-HX`)» 🟡 y deuda 0.
- Nuevo `docs/migracion-arquitectura.md` (mapeo `packages/` → `libs/` y fases F0–F5).
- `README.md` raíz y `AGENTS.md`: apuntan al objetivo sin falsear el estado.
- `rules/test/README.md`: nota de **ADR-29** (Vitest objetivo; `node --test` vigente).

## F0 — Andamiaje ejecutado (mismo día)

- **`libs/`** creado (vacío, con `README.md`): hogar objetivo de las capas hexagonales.
- **`scripts/check-boundaries.mjs`**: verificador de fronteras **sin dependencias** que
  aplica la matriz `R-HX-2` (129 imports entre paquetes verificados). Integrado en
  `npm run lint` (`npm run boundaries:check`), gate `G-7`.
- **`eslint-plugin-boundaries` descartado**: al instalarlo introdujo **4 high + 1
  critical** (`handlebars`, `micromatch`/`braces`), rompiendo `R-QA-6`. ADR-28 admitía
  «o equivalente»; se documenta la revisión en ADR-28 y se restaura `npm audit` a **0**.
- **2 excepciones legacy** toleradas por ruta `packages/` (`ai→redis`, `commands→security`),
  que desaparecen solas al migrar (ADR-30).
- `package.json`: `lint` pasa a `eslint apps packages libs scripts … && node scripts/check-boundaries.mjs`;
  nuevo script `boundaries:check`.

## Estado

- **Código sin mover**: todo sigue en `packages/`; `libs/` solo tiene su README. La
  migración F1–F5 de ADR-30 no ha comenzado.
- `R-HX-4` (enforcement por lint) **activo** vía `scripts/check-boundaries.mjs`, con las
  2 excepciones legacy declaradas; sin violaciones nuevas.
- `eslint-plugin-boundaries` **no** se usa (vulnerabilidades); `npm audit` sigue en **0**.
- Runner: sigue siendo **`node --test`**; Vitest es objetivo (ADR-29).
- Gates: `G-1..G-9` sin cambios; la verificación `build` + `lint` + `test` queda en verde
  y `npm audit` en 0.

---

# AUDIT — Migración hexagonal completada + Vitest (F0–F5)

- **Fecha:** 2026-10-09
- **Disparador:** cierre de la migración a arquitectura hexagonal (F1–F4) y adopción del
  runner **Vitest** (F5, ADR-29), en PRs atómicos sobre `main`.

## Qué cambió

- **Estructura**: `packages/` retirado; 14 libs en `libs/{shared,domain,application,infrastructure}`
  (`@ai-scraper/<capa>-<contexto>`), 2 apps como composition root. Verificador
  `scripts/check-boundaries.mjs` en `npm run lint` (`R-HX-4`), **sin excepciones legacy**.
- **Runner**: `node --test` (ADR-03) → **Vitest** (ADR-29) + `@vitest/coverage-v8`;
  `vitest.config.mjs`. 31 ficheros de test migrados; `before`/`after` → `beforeAll`/`afterAll`.
- **Cobertura**: base dist (Node) → fuentes **TS** (Vitest); medido 66.6 / 55.06 / 57.06;
  umbral re-basado a **65 / 54 / 56** (`R-COV-5`, ADR-29). `R-MT-1`: el disparador
  (runner soportado por Stryker) **se cumple** con Vitest.
- Pruebas: **167 tests / 28 ficheros** en `npm test`, 9 de contrato y 7 de integración.

## Estado

- `packages/` no existe; `tsconfig.base.json` solo mapea `libs/*/*/dist`; `npm audit` **0**.
- Gates `G-1..G-9` verdes (Vitest para `G-1`/`G-3`, contrato `G-5`, integración `G-4`).
- Deuda viva: adoptar **Stryker** sobre `src`; sin protección de rama; promoción entre entornos.

---

# AUDIT — Mutation testing con Stryker (ADR-31)

- **Fecha:** 2026-10-09
- **Disparador:** con Vitest (ADR-29) el disparador de `R-MT-1` (ADR-20) se cumple; se
  adopta Stryker.

## Qué cambió

- `@stryker-mutator/core` + `@stryker-mutator/vitest-runner` (devDependencies);
  `stryker.config.mjs` (mutación sobre `libs/domain/*/dist`, `libs/shared/core` y
  `libs/shared/security`; umbrales `R-MT-2`; `break: null` hasta baseline) y script
  `npm run test:mutation`.
- `override` de `qs ^6.16.0` para mantener `npm audit` en **0** (Stryker → `typed-rest-client` → `qs`).
- `ADR-31`; revisión de `ADR-20`; `R-MT-1` actualizada; `.gitignore` con `.stryker-tmp/` y `reports/`.

## Estado

- Stryker ejecuta y **mata mutantes** (p. ej. `normalizeJobLimits` en `libs/domain/execution`);
  el **baseline es bajo** → trabajo de mejora de tests (`R-MT-3`). No es gate de PR.
- `npm audit` en **0**; gates `G-1..G-9` sin cambios.

---

# AUDIT — Promoción entre entornos (ADR-32)

- **Fecha:** 2026-10-09
- **Disparador:** cerrar `R-GE-5` (última deuda de entrega): promover entre entornos.

## Qué cambió

- Nuevo `.github/workflows/promote.yml` (`workflow_dispatch`, `dry_run`): valida tag +
  procedencia en `main` + `ci` verde y **reetiqueta el mismo digest** de la release como
  `:staging`/`:production` (`docker buildx imagetools create`), bajo `environment`.
- `ADR-32`; `R-GE-5` pasa de deuda a implementada; `git/00-entornos.md` (tabla de
  entornos); `ci/01-flujos.md` (`R-CI-4`, cuarto workflow) y `ci/README.md`; `cd/`.

## Estado

- Mecanismo **declarado y reproducible**; su run real depende de que el operador cree los
  *environments* `staging`/`production` con aprobación y secretos.
- Staging y producción consumen el **mismo digest** (inmutabilidad, `R-CD-3`).
- `npm audit` en **0**; sin cambios en gates.

# AUDIT — Stryker con command runner (falsos supervivientes del runner de Vitest)

- **Fecha:** 2026-10-09
- **Disparador:** el runner de Vitest de Stryker reportaba como `Survived` mutantes que un
  test mata al aplicar el cambio a mano (bug conocido stryker-js #6073/#4306).

## Qué cambió

- `stryker.config.mjs`: `testRunner: 'command'` (muta el `dist` en disco y lanza los tests
  de lógica pura en un proceso nuevo por mutante), con los tests del área crítica.
- `libs/domain/execution`: score **45.45 % → 92.73 %** (51/55; los 4 restantes son
  boilerplate de interoperabilidad de TS). Verificado.
- `R-MT-1`, `ADR-31` (revisión), `test/README.md` y `_meta/AUDIT.md`.

## Estado

- El score vuelve a ser fiable (command runner). Falta medir/endurecer DSL y SSRF.
- `npm audit` en **0**; gates sin cambios.

- **Fecha:** 2026-10-09
- **Disparador:** el run post-merge de `main` falló en "Initialize containers":
  `toomanyrequests: You have reached your unauthenticated pull rate limit` al tirar
  `postgres:16-alpine` (Docker Hub) en `build-test-lint` e `integration`.

## Qué cambió

- `ci.yml` y `e2e.yml`: las imágenes de **servicios efímeros** pasan a
  `mirror.gcr.io/library/{postgres:16-alpine,mongo:7-jammy,redis:7-alpine}` (espejo de
  Docker Hub sin autenticación) → sin *rate limit* en runners compartidos (`R-EN-2`).
- `docs/rules/ci/02-entorno.md` (`R-EN-2`), `ci/README.md` y `_meta/AUDIT.md`.

## Estado

- Fallo de **infra** (Docker Hub), no de código: los checks de PR de #41/#42 estaban verdes.
- `docker-compose.yml` (dev local) mantiene los tags de Docker Hub a propósito.
- `npm audit` en **0**; gates sin cambios.

---

# AUDIT — Conformidad hexagonal después del traslado físico (ADR-33)

- **Fecha:** 2026-10-10
- **Disparador:** revisar si la migración F0–F5 produjo realmente puertos y adaptadores,
  no solo la topología `apps/` + `libs/`.

## Evidencia

- `packages/` está retirado; hay 14 libs, 2 apps y Vitest está activo: el traslado
  físico sí terminó.
- `npm run boundaries:check` pasa y reporta 129 imports, pero solo cubre imports
  `@ai-scraper/*` por capa; no prueba manifests, ownership de puertos ni apps delgadas.
- `apps/worker/src/agent-runner.ts` (592 líneas), `apps/api/src/jobs/jobs.service.ts`
  (223), `apps/worker/src/job-processor.ts` (211) y `sessions.service.ts` (172) contienen
  workflows/casos de uso que deben vivir en application.
- `JobStore`, `SessionStore`, `JobQueue`, `JsonCache`, `EngineMemory` y
  `EnginePageCache` se declaran públicamente en infraestructura.
- `libs/infrastructure/mongodb/src/radiography.ts` importa directamente crawler y
  execution, acoplando tres adaptadores.
- `domain/ai` usa `assertPublicUrl`, cuya decisión de bypass consulta `process.env` a
  través de `isPrivateHostsAllowed`; el dominio no queda completamente determinista.
- Los tres contextos de dominio mantienen `src/` plano aunque `R-HX-8` exige separar
  responsabilidades reales por rol.

## Decisión y estado

- ADR-33 separa **traslado físico F0–F5** de **conformidad hexagonal F6–F10**.
- Se añaden `R-HX-10..14` (apps delgadas, puertos del consumidor, adaptadores
  independientes, límites de shared y definición de cierre) y se endurece `R-HX-2`.
- F6 (norma + baseline) queda completada. F7–F10 quedan abiertas.
- El snapshot pasa de 🟢 a 🟡: **traslado físico completado, conformidad hexagonal
  pendiente**. No se cambió runtime ni contrato HTTP en esta auditoría documental.
- Verificación local: build y lint verdes; **174/174** tests (29 ficheros), contrato
  **9/9** y OpenAPI sincronizada. Las pruebas que enlazan puertos se ejecutaron fuera
  del sandbox; la primera ejecución confinada falló por `EPERM`, no por el proyecto.

---

# F7.1 — Puertos de ejecución propiedad de application

- **Fecha:** 2026-10-10
- **Disparador:** ejecutar el primer corte del orden recomendado por ADR-33 sin cambiar
  endpoints ni comportamiento.

## Cambio y evidencia

- Se crea `@ai-scraper/application-execution` con los puertos `JobStore`,
  `SessionStore`, `JobQueue`, sus DTOs y la regla pura `normalizePriority`.
- Prisma, memoria y BullMQ implementan esos contratos desde infraestructura; storage y
  queue dejan de declarar o reexportar los tres puertos.
- API y worker reciben esos tipos desde application; las factories concretas siguen en
  los composition roots.
- El trabajo se aisló en `refactor/arquitectura-puertos-ejecucion`; no se hizo stage,
  commit ni push automático (`R-AC-3`, `R-GA-1`).
- `boundaries:check` omite artefactos generados y falla si cualquiera de los tres
  puertos vuelve a declararse o reexportarse en infraestructura (`R-HX-11`).
- F7 continúa abierta: faltan caché/motor/repositorios y ordenar el dominio por roles.
- Verificación local: build y lint verdes; **174/174** tests (29 ficheros), cobertura
  **66.61/55.02/57.06**, contrato **9/9** y OpenAPI sincronizada.

---

# R-EN-3 — Evidencia JUnit independiente por suite

- **Fecha:** 2026-10-10
- **Disparador:** la auditoría detectó que `test:contract` sobrescribía el JUnit de
  `npm test` y que `integration`/`e2e` no publicaban sus reportes.

## Cambio y evidencia

- Vitest acepta `VITEST_JUNIT_OUTPUT_FILE`; unit, contrato, integración y E2E escriben
  ficheros distintos.
- `build-test-lint`, `integration` y `e2e` publican artifacts con `if: always()` y
  `if-no-files-found: error` (`R-EN-3`).
- Run `38068883867` en el SHA `98c089f`: `build-test-lint` e `integration` en
  `success`; pasos de upload en verde.
- Artifacts descargados y verificados: **174/174 unitarios**, **9/9 contrato** y
  **7/7 integración**, en tres XML independientes y sin sobrescritura.

---

# Corrección de deriva documental (AUDIT.md + endpoints)

- **Fecha:** 2026-10-11
- **Disparador:** detección de drift en `AUDIT.md:35` (decía "3 ramas locales, 119 commits"; real: **1 rama `main`, 122 commits**) y omisión de `POST /api/v1/auth/register-first` y `POST /api/v1/jobs/:id/retry` en `AGENTS.md` y `README.md` (ya presentes en `docs/openapi.json` y código).

## Cambio y evidencia

- `docs/rules/_meta/AUDIT.md:35`: corregidos números de ramas (1) y commits (122) tras `git branch -a` y `git rev-list --count main`.
- `AGENTS.md`: añadidos `POST /api/v1/auth/register-first` y `POST /api/v1/jobs/:id/retry` a la lista de endpoints.
- `README.md`: añadido `POST /api/v1/jobs/:id/retry` a la lista de endpoints de Jobs.
- Verificación: `npm run openapi:check` (sin cambios), `npm run lint` (verde), `MONGODB_MOCK=1 npm test` (174/174 verde), cobertura 66/55/57.
- Rama: `docs/fix-audit-snapshot-and-endpoints` (semántica, desde `main` actualizado).

---

# Cierre F7–F10 y conformidad hexagonal

- **Fecha:** 2026-11-11
- **Disparador:** cierre de las fases F7–F10 de ADR-33 y verificación de `R-HX-14`.

## Cambio y evidencia

- **F7:** puertos de cache/proveedor/motor/memoria en `application/*`/`domain/scraper`;
  roles de dominio (`entities/value-objects/services`); política SSRF inyectada.
- **F8:** casos de uso de jobs, sesiones, usuarios, radiografía y workflow del agente
  en `application/execution` y `application/scraper`; `apps/*` queda como composition
  root. Tests con dobles de puertos en `tests/*-use-cases.test.mjs`.
- **F9:** `infrastructure/mongodb` desacoplado de crawler/execution; radiografía y
  loop heurístico en `application/scraper`; cero imports entre adaptadores.
- **F10:** `check-boundaries.mjs` valida **99 imports + 18 manifests**, prohíbe
  adaptador→adaptador y protege 18 puertos; `tests/architecture.test.mjs` (5 tests)
  fija los criterios de `R-HX-14`.
- **Medición local:** `npm run build` ✅, `npm run lint` ✅ (0/0),
  `MONGODB_MOCK=1 npm test` → **254/254**, cobertura **70.20/58.62/60.57**,
  `test:contract` 9/9, `openapi:check` ✅.
- **Deuda nueva detectada:** `npm audit` → 5 high / 27 moderate (avisos 2026-11);
  se registra como deuda de mantenimiento separada, no de arquitectura.
- **Límite del entorno:** integración y E2E no re-ejecutados en Android/Termux
  (requieren Docker/Chromium); su evidencia histórica de CI se conserva.

---

# Cierre N1–N3 + mantenimiento de seguridad

- **Fecha:** 2026-11-11
- **Alcance:** webhooks firmados, jobs programados y comandos EXTRACT_TABLE/EXTRACT_TEXT.

## Cambio y evidencia

- **N1 Webhooks:** `webhookUrl` en jobs, SSRF centralizado (`safePostJson`, sin
  redirects), firma HMAC-SHA256, 3 reintentos y métricas de envío/fallo.
- **N2 Schedules:** modelo `JobSchedule`, API CRUD/pausa/resume, scheduler en worker
  con lock Redis por schedule y cierre por `maxRuns`.
- **N3 Extracción:** DSL a 17 comandos (`EXTRACT_TABLE`, `EXTRACT_TEXT`), normalizador,
  límites, prompts y motor con trazabilidad `_source`.
- **Mantenimiento:** `npm audit` de 5 high / 27 moderate a **0 high / 12 moderate**
  (upstream `crawlee→minimatch`); actualizados zod 4.6.7, mongoose 8.24.8,
  `@nestjs/platform-express` 12.4.2 y overrides de `minimatch`.
- **Medición local:** build ✅, lint 0/0 (110 imports + 19 manifests),
  `MONGODB_MOCK=1 npm test` → **266/266**, cobertura **70.91/59.21/61.61**,
  contrato **11/11**, OpenAPI sincronizada, `prisma validate` ✅.
- **Límite:** integración/E2E no re-ejecutados en Android sin Docker/Chromium.

---

# API keys de cliente

- **Fecha:** 2026-11-12
- **Alcance:** emisión, listado y revocación de claves de cliente por API.

## Cambio y evidencia

- Modelo `ApiKey` (hash SHA-256, prefijo, rol, `lastUsedAt`, `revokedAt`) y migración.
- Endpoints `POST/GET/DELETE /api/v1/auth/api-keys`, protegidos por `ApiKeyGuard` + `AdminGuard`.
- Claves de entorno y usuarios `superadmin` administran; las claves de cliente tienen rol
  `user`, consumen la API normal y no pueden administrar claves.
- El secreto se devuelve una sola vez; en BD solo queda el hash. `authScope` por clave
  mantiene aislamiento de jobs entre clientes.
- Evidencia: unitarios de casos de uso/guards, contrato de API (12/12), OpenAPI sincronizada,
  build/lint/test verdes.

---

# Render configurable para SPAs y progreso SSE

- **Fecha:** 2026-11-12
- **Alcance:** soporte de apps Angular/React/Vue y comunicación en vivo con clientes.

## Cambio y evidencia

- `render` por job/schedule: `mode` (auto/always/never), `waitUntil`, `waitForSelector`,
  `waitMs` y `timeoutMs`; persistido en `Job`/`JobSchedule` (JSONB).
- El motor espera hidratación del DOM (estabilidad de nodos/texto) y aplica la
  configuración al adaptador Playwright; `always` fuerza Chromium y `never` lo desactiva.
- SSE `GET /api/v1/jobs/:id/events`: snapshot inicial + eventos `progress`
  (observe/decision/step/recovery/status/finished), con ownership y `x-api-key`.
- Bus de progreso Redis pub/sub con fallback en memoria (`job-progress:<id>`).
- Evidencia: unitarios de render/progreso, contrato 13/13, OpenAPI sincronizada,
  build/lint/test verdes.

---

# P1 — golden set y métricas de precisión

- **Fecha:** 2026-11-12
- **Alcance:** medir precisión real por campo antes de optimizar extracción.

## Cambio y evidencia

- Evaluador puro `evaluatePrecision` (`application/scraper`): `precision`, `recall`,
  `f1`, `fillRate`, `wrongValueRate` global y por campo, con `matchBy`, comparación
  case-insensitive y tolerancia numérica.
- CLI `npm run precision:check` sobre fixtures JSON (`expected`/`actual`) y umbral
  opcional `PRECISION_MIN`.
- Tests de dataset perfecto, campos ausentes/erróneos, items extra y tolerancias.
- Evidencia: 278/278 tests, cobertura 71.09/58.92/61.63, build/lint verdes.
