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

libs/shared/*     transversal pura: la puede importar cualquier capa, ella no importa ninguna
```

## Reglas

| ID | Regla |
|---|---|
| R-HX-1 | **Cuatro capas y un borde (modelo canónico)**: el código interno vive bajo `libs/` repartido en `domain/<contexto>` (entidades, value objects, servicios puros y **puertos**), `application/<contexto>` (casos de uso y DTOs), `infrastructure/<adaptador>` (adaptadores concretos) y `shared/<utilidad>` (transversal sin lógica de negocio); `apps/*` es el **composition root**. Este modelo sustituye la vista de «5 capas» que describía `R-AR-2`: donde una regla de otra área nombre una capa, se lee con esta tabla. |
| R-HX-2 | **Dirección de dependencia permitida (aristas prohibidas fallan)**: `shared` no importa ninguna otra capa; `domain` puede importar `shared` y **nada más**; `application` puede importar `domain` + `shared`; `infrastructure` puede importar `domain` + `application` + `shared`; `apps/*` puede importar `application` + `infrastructure` + `shared`. Prohibido: `domain`→`application`/`infrastructure`/`apps`, `application`→`infrastructure`/`apps`, `infrastructure`/`shared`→`apps`, y cualquier import de `apps/*` desde `libs/*`. |
| R-HX-3 | **Puertos en el dominio, adaptadores en infraestructura**: las interfaces de salida (repositorios, cola, proveedor de IA, motor, caché) se declaran en `domain/*/ports/` (o en `application` si son puertos que solo usa un caso de uso) y su única implementación concreta vive en `infrastructure/`. `domain` y `application` **prohibido** importar un SDK externo (`prisma`, `@prisma/client`, `mongoose`, `bullmq`, `crawlee`, `playwright`, el SDK de OpenRouter) o hacer I/O (`fetch`, `fs`, sockets). |
| `R-HX-4` | **Fronteras verificables por lint**: el verificador [`scripts/check-boundaries.mjs`](../../../../scripts/check-boundaries.mjs) clasifica cada paquete por su capa (`domain`, `application`, `infrastructure`, `shared`, `app`) y aplica la matriz de aristas de `R-HX-2`; las **excepciones legacy** se declaran por ruta `packages/<x>` y desaparecen solas al migrar a `libs/`. Se ejecuta dentro de `npm run lint` (`npm run boundaries:check`). Un import que cruce una frontera **falla `npm run lint`** (gate `G-7`), igual que un error de tipos. Se eligió este verificador sin dependencias frente a `eslint-plugin-boundaries` porque el plugin introduce vulnerabilidades `high`/`critical` que rompen `R-QA-6` (ADR-28, revisión 2026-10-09). |
| R-HX-5 | **Composición solo en el borde**: la instanciación de adaptadores (`new PrismaClient()`, crear la conexión BullMQ/Redis, arrancar el pool de Crawlee, construir el proveedor de IA) ocurre **únicamente** en `apps/*` o en una `factory` de `infrastructure/`. `application` recibe sus dependencias por constructor (inyección); prohibido que un caso de uso instancie un adaptador o lea variables de entorno para decidir un adaptador concreto. |
| R-HX-6 | **Ubicación por bounded context y nombre de paquete**: una lib vive en `libs/<capa>/<contexto>` con contextos `scraper`, `ai` y `execution` (los tres del dominio) y los adaptadores que correspondan; el paquete se llama `@ai-scraper/<capa>-<contexto>` (p. ej. `@ai-scraper/domain-scraper`, `@ai-scraper/infrastructure-ai-providers`). Un contexto nuevo se crea con su carpeta, su `README.md` (`R-DO-1`) y su lugar explicado en `migracion-arquitectura.md`. |
| R-HX-7 | **La persistencia es un adaptador, no una capa**: el esquema y las migraciones de Prisma viven en `prisma/` (raíz del repo) y el código que los consume vive en `libs/infrastructure/persistence/prisma`; la implementación en memoria para tests vive en `libs/infrastructure/persistence/memory`. `domain`/`application` no conocen Prisma ni Mongoose: hablan con un puerto de repositorio (`R-HX-3`). |
| R-HX-8 | **Estructura interna de una lib de dominio**: `src/entities/`, `src/value-objects/`, `src/services/` (funciones/clases puras) y `src/ports/` (interfaces); `src/index.ts` expone **solo** la superficie pública (entidades, value objects, puertos y servicios que otras capas pueden usar). Prohibido exportar detalles internos o un adaptador desde un `index.ts` de `domain`. |
| R-HX-9 | **Migración strangler, sin big-bang**: un paquete que aún no ha migrado conserva su ruta `packages/<x>`, su nombre y sus imports; ningún PR de migración puede dejar `npm run build`, `npm run lint` o `MONGODB_MOCK=1 npm test` en rojo. `packages/` solo desaparece cuando migre su último paquete, y entonces se retira de `workspaces`, de `tsconfig.base.json` y del lint **en el mismo cambio**. Prohibido mover varios contextos no relacionados en un mismo PR (`R-PR-2`, `R-AC-3`). |

## Verificación

```bash
# R-HX-2/R-HX-4: ninguna arista prohibida (se ejecuta dentro de `npm run lint`)
npm run boundaries:check

# R-HX-3: el dominio no importa frameworks ni hace I/O (debe imprimir vacío)
grep -rEn "from '(prisma|@prisma/client|mongoose|bullmq|crawlee|playwright)|require\('(prisma|mongoose|bullmq|crawlee)" \
  libs/domain libs/application 2>/dev/null

# R-HX-9: durante la migración conviven packages/ y libs/; al cerrar, packages/ vacío
ls packages 2>/dev/null; ls libs 2>/dev/null
```

## Pendientes

- **Excepciones legacy de fronteras** (`R-HX-4`): el verificador está **activo** y
  falla ante cualquier arista prohibida nueva, pero tolera dos aristas heredadas de
  `packages/` (`ai→redis`, `commands→security`). Deben quedar a **0** al cerrar F5, sin
  tocar el verificador (desaparecen al migrar el paquete, ADR-30).
- **Migración en curso** (`R-HX-9`): los paquetes siguen en `packages/`; el orden de
  movida y su mapeo viven en [`../../migracion-arquitectura.md`](../../migracion-arquitectura.md)
  (ADR-30).
