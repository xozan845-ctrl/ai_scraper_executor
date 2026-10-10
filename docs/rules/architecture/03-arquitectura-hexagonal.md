# 03 — Reglas Doradas de Arquitectura Hexagonal

Aplica a: la organización del monorepo en capas (`domain`, `application`,
`infrastructure`, `shared`) y a la **dirección de dependencias** entre ellas. Es el
modelo **canónico** del repo (ADR-27) y **sustituye** la vista de «5 capas» de
`R-AR-2`; el mapeo de los paquetes actuales a `libs/` vive en
[`../../migracion-arquitectura.md`](../../migracion-arquitectura.md).

> **La regla que manda sobre todas las de esta área:** el **dominio no conoce
> frameworks**. Si una regla de negocio necesita Prisma, BullMQ, Crawlee o el SDK de
> OpenRouter para poder escribirse, la dependencia está del lado equivocado.

## Capas y dirección de dependencia

```
apps/*            (composition root: instancia adaptadores y los inyecta)
  │  puede importar ↓
  ├── libs/application/*     (casos de uso; coordina puertos)
  │        │  puede importar ↓
  │        └── libs/domain/*  (entidades, value objects, servicios puros, puertos)
  └── libs/infrastructure/*  (adaptadores concretos; implementan puertos)
           │  puede importar ↓
           └── libs/domain/* · libs/application/*

libs/shared/*     transversal sin lógica de contexto: cualquier capa puede importarla; ella no importa capas
```

La flecha indica dependencia de código fuente. Una dependencia declarada en
`package.json`, un `import type`, un `import()` dinámico y un `require()` cuentan igual:
la inversión de dependencias no depende de si el import existe solo en tiempo de tipos
o se resuelve en runtime.

## Reglas

| ID | Regla |
|---|---|
| R-HX-1 | **Cuatro capas y un borde (modelo canónico)**: el código interno vive bajo `libs/` repartido en `domain/<contexto>` (entidades, value objects, servicios puros y **puertos**), `application/<contexto>` (casos de uso y DTOs), `infrastructure/<adaptador>` (adaptadores concretos) y `shared/<utilidad>` (transversal sin lógica de negocio); `apps/*` es el **composition root**. Este modelo sustituye la vista de «5 capas» que describía `R-AR-2`: donde una regla de otra área nombre una capa, se lee con esta tabla. |
| R-HX-2 | **Dirección de dependencia permitida (aristas prohibidas fallan)**: `shared` no importa ninguna otra capa; `domain` puede importar `shared` y **nada más**; `application` puede importar `domain` + `shared`; `infrastructure` puede importar `domain` + `application` + `shared`; `apps/*` (composition root) puede importar `application` + `infrastructure` + `domain` + `shared`. Dos adaptadores bajo `infrastructure/*` no se importan entre sí: se conectan en `apps/*` mediante un puerto. Prohibido: `domain`→`application`/`infrastructure`/`apps`, `application`→`infrastructure`/`apps`, `infrastructure`→otro adaptador/`apps`, `shared`→`domain`/`application`/`infrastructure`/`apps`, y cualquier import de `apps/*` desde `libs/*`. |
| R-HX-3 | **Puertos en el dominio, adaptadores en infraestructura**: las interfaces de salida (repositorios, cola, proveedor de IA, motor, caché) se declaran en `domain/*/ports/` (o en `application` si son puertos que solo usa un caso de uso) y su única implementación concreta vive en `infrastructure/`. `domain` y `application` **prohibido** importar un SDK externo (`prisma`, `@prisma/client`, `mongoose`, `bullmq`, `crawlee`, `playwright`, el SDK de OpenRouter) o hacer I/O (`fetch`, `fs`, sockets). |
| `R-HX-4` | **Fronteras verificables por lint**: el verificador [`scripts/check-boundaries.mjs`](../../../scripts/check-boundaries.mjs) debe clasificar cada lib por su capa (`domain`, `application`, `infrastructure`, `shared`, `app`) y comprobar imports de fuente y manifiestos contra `R-HX-2`; se ejecuta dentro de `npm run lint` (`npm run boundaries:check`). Un import o dependencia nueva que cruce una frontera **debe fallar `npm run lint`** (gate `G-7`). La auditoría distingue expresamente esta comprobación de aristas de la conformidad completa de `R-HX-14`: que `boundaries:check` pase no demuestra por sí solo que los puertos y casos de uso estén en la capa correcta. Se eligió un verificador sin dependencias frente a `eslint-plugin-boundaries` porque el plugin introduce vulnerabilidades `high`/`critical` que rompen `R-QA-6` (ADR-28, revisiones 2026-10-09 y 2026-10-10). |
| R-HX-5 | **Composición solo en el borde**: la instanciación de adaptadores (`new PrismaClient()`, crear la conexión BullMQ/Redis, arrancar el pool de Crawlee, construir el proveedor de IA) ocurre **únicamente** en `apps/*` o en una `factory` de `infrastructure/`. `application` recibe sus dependencias por constructor (inyección); prohibido que un caso de uso instancie un adaptador o lea variables de entorno para decidir un adaptador concreto. |
| R-HX-6 | **Ubicación por bounded context y nombre de paquete**: una lib vive en `libs/<capa>/<contexto>` con contextos `scraper`, `ai` y `execution` (los tres del dominio) y los adaptadores que correspondan; el paquete se llama `@ai-scraper/<capa>-<contexto>` (p. ej. `@ai-scraper/domain-scraper`, `@ai-scraper/infrastructure-ai-providers`). Un contexto nuevo se crea con su carpeta, su `README.md` (`R-DO-1`) y su lugar explicado en `migracion-arquitectura.md`. |
| R-HX-7 | **La persistencia es un adaptador, no una capa**: el esquema y las migraciones de Prisma viven en `prisma/` (raíz del repo); el código que los consume vive en `libs/infrastructure/storage` (`JobStore` Prisma + `InMemoryJobStore`) y MongoDB en `libs/infrastructure/mongodb`. `domain`/`application` no conocen Prisma ni Mongoose: hablan con un puerto de repositorio (`R-HX-3`). |
| R-HX-8 | **Estructura interna de una lib de dominio**: `src/entities/`, `src/value-objects/`, `src/services/` (funciones/clases puras) y `src/ports/` (interfaces); `src/index.ts` expone **solo** la superficie pública (entidades, value objects, puertos y servicios que otras capas pueden usar). Prohibido exportar detalles internos o un adaptador desde un `index.ts` de `domain`. |
| R-HX-9 | **Migración strangler, sin big-bang**: la migración a `libs/` se hizo por unidades temáticas —un contexto, o una capa completa como lote homogéneo aprobado— y ningún PR podía dejar `npm run build`, `npm run lint` o `MONGODB_MOCK=1 npm test` en rojo. **`packages/` está retirado** (último paquete: `ai` → `libs/application/ai`): ya no existe en `workspaces`, `tsconfig.base.json`, cobertura ni lint. Cualquier reorganización futura de capas sigue el mismo principio: un tema por PR y el repo verde en todo momento. |
| R-HX-10 | **Apps delgadas y composition root localizado**: `apps/api` contiene bootstrap, módulos, guards/interceptors, DTOs de transporte y controladores HTTP; `apps/worker` contiene bootstrap y consumidores de cola. Los controladores y consumidores traducen transporte ↔ DTO, invocan **un caso de uso** y mapean su resultado. Prohibido alojar en `apps/*` reglas de negocio, coordinación de repositorios/colas/LLM/crawler, fallback de persistencia o workflows Observe→Think→Act. La creación y selección de adaptadores se concentra en `main.ts`, módulos/proveedores de composición o factories de infraestructura; no se dispersa por services/controllers. |
| R-HX-11 | **Propiedad de puertos y contratos**: un puerto requerido por negocio pertenece al consumidor, en `domain/<contexto>/src/ports/` cuando expresa una capacidad del dominio o en `application/<contexto>/src/ports/` cuando solo sirve a un caso de uso. `infrastructure/*` implementa esos puertos y puede declarar únicamente tipos privados de su SDK/adaptador. Prohibido que `application` o `apps` tipen sus dependencias con interfaces públicas importadas desde `infrastructure` (`JobStore`, `SessionStore`, `JobQueue`, caché, proveedor, motor o repositorio). |
| R-HX-12 | **Adaptadores independientes**: cada `libs/infrastructure/<adaptador>` es una hoja conectable. Prohibido importar otro paquete `@ai-scraper/infrastructure-*` para completar un workflow; si MongoDB necesita crawling, o storage necesita cola, la coordinación vive en un caso de uso de `application` que recibe ambos puertos y `apps/*` inyecta ambos adaptadores. Una excepción técnica exige ADR, alcance exacto y test de arquitectura; no se admite una excepción genérica `infrastructure→infrastructure`. |
| R-HX-13 | **`shared` no es un cajón de sastre**: `shared/core`, `shared/contracts` y `shared/config` contienen tipos/utilidades transversales sin lógica de un bounded context; `shared/observability` y la parte técnica de seguridad pueden encapsular capacidades transversales de runtime, pero no decisiones de negocio. El dominio solo importa desde `shared` contratos o funciones deterministas sin I/O. DNS, red, filesystem, reloj de sistema, variables de entorno, logging y métricas se consumen fuera del dominio mediante puertos o en el borde. |
| R-HX-14 | **Definición verificable de conformidad hexagonal**: no se declara la arquitectura «completada» por tener `apps/` + `libs/` o por retirar `packages/`. El cierre exige simultáneamente: (a) `R-HX-2`/`R-HX-4` verdes sobre imports **y** `package.json`; (b) cero puertos de negocio públicos en infraestructura (`R-HX-11`); (c) cero imports entre adaptadores (`R-HX-12`); (d) controladores/consumidores delgados y casos de uso en `application` (`R-HX-10`); (e) dominio sin I/O ni SDKs (`R-HX-3`/`R-HX-13`); (f) tests unitarios de casos de uso con dobles de puertos; y (g) el gate de cierre completo verde. Hasta entonces el estado correcto es **migración física completada, conformidad hexagonal pendiente**. |

## Verificación

```bash
# R-HX-2/R-HX-4: ninguna arista prohibida (se ejecuta dentro de `npm run lint`)
npm run boundaries:check

# R-HX-3: el dominio no importa frameworks ni hace I/O (debe imprimir vacío)
grep -rEn "from '(prisma|@prisma/client|mongoose|bullmq|crawlee|playwright)|require\('(prisma|mongoose|bullmq|crawlee)" \
  libs/domain libs/application 2>/dev/null

# R-HX-9: `packages/` retirado; todo vive en `libs/`
ls packages 2>/dev/null || true; ls libs

# R-HX-10/R-HX-11: la auditoría debe devolver vacío al cerrar la migración
rg -n "@ai-scraper/infrastructure-" apps --glob '**/src/**/*.ts' \
  --glob '!**/main.ts' --glob '!**/*.module.ts' --glob '!**/providers.ts'
grep -rEn "export (interface|abstract class).*(Store|Repository|Queue|Provider|Engine|Cache)" \
  libs/infrastructure --include='*.ts'

# R-HX-12: ningún adaptador importa otro adaptador
grep -rEn "from ['\"]@ai-scraper/infrastructure-" libs/infrastructure --include='*.ts'
```

## Pendientes

- **Traslado físico F0–F5 completado** (`R-HX-9`): `packages/` está retirado y Vitest
  está adoptado. La auditoría del 2026-10-10 encontró que la **conformidad funcional
  sigue pendiente**: lógica de aplicación en `apps/*`, puertos públicos en
  `infrastructure/*` y acoplamiento entre adaptadores. El cierre se rige por
  `R-HX-10..14`, ADR-33 y las fases F6–F10 de
  [`../../migracion-arquitectura.md`](../../migracion-arquitectura.md).
