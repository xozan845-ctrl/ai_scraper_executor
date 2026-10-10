# Migración a arquitectura hexagonal — plan, auditoría y mapeo

> **Estado: traslado físico completado; conformidad hexagonal pendiente
> (2026-10-10).** F0–F5 retiraron `packages/`, movieron las 14 librerías a `libs/` y
> adoptaron Vitest. F7 está en curso: los puertos de jobs, sesiones y cola ya pertenecen
> a `application/execution`, pero todavía hay casos de uso en `apps/*`, otros puertos
> declarados en `infrastructure/*` y un adaptador que importa otros adaptadores. ADR-33
> abre F6–F10 para cerrar esa diferencia. Las reglas canónicas son
> [`R-HX-1..14`](./rules/architecture/03-arquitectura-hexagonal.md).

## 1. Modelo objetivo

Arquitectura **hexagonal (puertos y adaptadores) por bounded contexts**
(ADR-27, precisada por ADR-33):

```text
ai-scraping-executor/
├── apps/                              # entry points y composición, sin casos de uso
│   ├── api/src/                       # bootstrap, módulos, controllers, guards, DTO HTTP
│   ├── worker/src/                    # bootstrap y consumers de cola
│   └── cli/                           # opcional; solo si aparece un caso real
├── libs/
│   ├── domain/
│   │   ├── scraper/src/{entities,value-objects,services,ports}/
│   │   ├── ai/src/{entities,value-objects,services,ports}/
│   │   └── execution/src/{entities,value-objects,services,ports}/
│   ├── application/
│   │   ├── scraper/src/{use-cases,dtos,ports}/
│   │   ├── ai/src/{use-cases,dtos,ports}/
│   │   └── execution/src/{use-cases,dtos,ports}/
│   ├── infrastructure/
│   │   ├── ai-providers/src/{openrouter,custom}/
│   │   ├── storage/src/{prisma,memory}/
│   │   ├── mongodb/src/
│   │   ├── queue/src/{bullmq,memory}/
│   │   ├── crawler/src/
│   │   ├── execution/src/
│   │   └── redis/src/
│   └── shared/
│       ├── core/
│       ├── security/
│       └── observability/
├── prisma/                            # esquema y migraciones
├── scripts/                           # tooling de desarrollo y CI
├── package.json                       # npm workspaces; no se adopta Nx por ahora
└── tsconfig.base.json
```

El árbol es una guía de responsabilidades, no una obligación de crear carpetas vacías.
Una carpeta o lib aparece cuando existe comportamiento real. Lo obligatorio es:

- `domain`: reglas puras y puertos que expresan capacidades del negocio;
- `application`: casos de uso que coordinan puertos y DTOs independientes del transporte;
- `infrastructure`: adaptadores reemplazables que implementan puertos;
- `apps`: traducción de entrada/salida y composición;
- `shared`: capacidades transversales sin reglas de un bounded context.

La dirección de dependencia está en `R-HX-2`; la propiedad de los puertos en
`R-HX-11`; el criterio de cierre en `R-HX-14`.

## 2. Mapeo físico `packages/` → `libs/` (completado)

| Origen (`packages/`, retirado) | Destino | Capa |
|---|---|---|
| `core` | `libs/domain/execution` + `libs/domain/scraper` + `libs/shared/core` | dominio + shared |
| `commands` | `libs/domain/ai` | dominio |
| `security` | `libs/shared/security` | shared transversal |
| `observability` | `libs/shared/observability` | shared transversal |
| `crawler` | `libs/infrastructure/crawler` | infraestructura |
| `execution-engine` | `libs/infrastructure/execution` | infraestructura |
| `ai` | `libs/application/ai` | aplicación |
| `ai-providers` | `libs/infrastructure/ai-providers` | infraestructura |
| `queue` | `libs/infrastructure/queue` | infraestructura |
| `redis` | `libs/infrastructure/redis` | infraestructura |
| `mongodb` | `libs/infrastructure/mongodb` | infraestructura |
| `storage` | `libs/infrastructure/storage` | infraestructura |
| `prisma/` (raíz) | `prisma/` (raíz, sin mover) | — |

Los nombres siguen `@ai-scraper/<capa>-<contexto>`. Haber completado este mapeo
demuestra ubicación física; no demuestra por sí solo puertos/adaptadores (`R-HX-14`).

## 3. Resultado de la auditoría de conformidad (2026-10-10)

| Criterio | Estado | Evidencia actual |
|---|---|---|
| Topología `apps/` + `libs/`; `packages/` retirado | ✅ | 15 libs, 2 apps, workspaces `apps/*` + `libs/*/*` |
| Nombres de paquetes y paths a `dist` | ✅ | `package.json` de cada lib + `tsconfig.base.json` |
| Dirección gruesa entre capas | 🟡 parcial | `npm run boundaries:check` pasa 77 imports de fuente y protege los tres puertos extraídos, pero todavía no inspecciona manifiestos ni toda la semántica de puertos |
| Dominio organizado por roles (`R-HX-8`) | ❌ | los tres contextos de dominio mantienen implementación plana en `src/*.ts`; no existen `entities/`, `value-objects/`, `services/` o `ports/` donde ya hay responsabilidades reales |
| Casos de uso en `application` | ❌ | existen `application/ai` y los contratos de `application/execution`, pero creación/reintento/cancelación de jobs, sesiones, usuarios, radiografía y ejecución del agente siguen en `apps/*` |
| Apps delgadas (`R-HX-10`) | ❌ | `apps/worker/src/agent-runner.ts` tiene 592 líneas; `jobs.service.ts` 223, `job-processor.ts` 211 y `sessions.service.ts` 172; coordinan adaptadores y reglas |
| Puertos propiedad del consumidor (`R-HX-11`) | 🟡 parcial | `JobStore`, `SessionStore` y `JobQueue` ya viven en `application/execution`; todavía quedan `JsonCache`, `EngineMemory`, `EnginePageCache` y otros contratos por clasificar/extraer |
| Adaptadores independientes (`R-HX-12`) | ❌ | `infrastructure/mongodb/src/radiography.ts` importa `infrastructure-crawler` e `infrastructure-execution` |
| Dominio sin I/O/SDK de infraestructura | ❌ | no importa Prisma/BullMQ/Crawlee/Playwright, pero `domain/ai` llama `assertPublicUrl`; esa función consulta `process.env` mediante `isPrivateHostsAllowed`, por lo que la política no es determinista ni está inyectada |
| Composition root concentrado | ❌ | además de `main.ts`/providers, services, guards, controllers y planner crean o resuelven adaptadores y leen configuración para decidir comportamiento |
| Definición completa de cierre (`R-HX-14`) | ❌ | no hay todavía un gate que cubra puertos, estructura interna, manifests, apps delgadas y acoplamiento entre adaptadores |

Conclusión: el repositorio tiene una **base modular útil**, pero hoy es una arquitectura
por capas con ubicación hexagonal parcial; no debe presentarse como hexagonal completada.
El detalle derivado vive en [`rules/_meta/AUDIT.md`](./rules/_meta/AUDIT.md).

## 4. Fases

La estrategia sigue siendo strangler: una unidad temática por PR y el repositorio verde
en cada paso (`R-HX-9`).

| Fase | Alcance | Estado |
|---|---|---|
| **F0 — Andamiaje** | Verificador de fronteras y `libs/` | ✅ |
| **F1 — `shared/`** | Migrar core transversal y observabilidad | ✅ |
| **F2 — `domain/`** | Mover tipos/reglas existentes a los tres contextos | ✅ físico |
| **F3 — seguridad + infraestructura** | Mover seguridad y adaptadores | ✅ físico |
| **F4 — `application/ai` + retirada de `packages/`** | Retirar el árbol anterior | ✅ físico |
| **F5 — runner y cierre físico** | Adoptar Vitest y recalibrar cobertura | ✅ |
| **F6 — contrato normativo y baseline** | ADR-33, `R-HX-10..14`, auditoría honesta y plan de deuda | ✅ |
| **F7 — puertos y dominio** | Mover contratos de queue/storage/cache/crawler/repositories al consumidor; organizar el dominio por roles sin cambiar conducta | 🔄 jobs/sesiones/cola extraídos |
| **F8 — casos de uso** | Crear `application/execution` y `application/scraper`; mover jobs, sesiones, usuarios/radiografía y el workflow del agente fuera de `apps/*` | ⏳ |
| **F9 — adaptadores y borde** | Desacoplar MongoDB de crawler/execution; dejar controllers/consumers delgados y composición concentrada | ⏳ |
| **F10 — enforcement y cierre** | Ampliar el verificador a manifests/puertos/acoplamientos, añadir tests de arquitectura y obtener todos los gates verdes | ⏳ |

## 5. Orden de extracción recomendado

1. ✅ Extraer los puertos de job/session storage y queue a
   `application/execution/src/ports/`; hacer que Prisma, memoria y BullMQ los
   implementen sin cambiar endpoints.
2. Mover `JobsService` a casos de uso pequeños (`CreateJob`, `ListJobs`, `GetJobResult`,
   `CancelJob`, `RetryJob`) y dejar el service/controller Nest como adaptador HTTP.
3. Extraer sesiones, bootstrap de usuario y radiografía a casos de uso; reemplazar los
   imports dinámicos de MongoDB por puertos.
4. Mover planner, `AgentRunner` y `job-processor` a casos de uso de
   `application/execution`/`application/scraper`; mantener en el worker solo el consumer
   y el wiring.
5. Separar las capacidades puras de seguridad de DNS/red y revisar qué parte puede ser
   importada por dominio (`R-HX-13`).
6. Endurecer `scripts/check-boundaries.mjs`, eliminar toda deuda temporal y cerrar F10.

## 6. Reglas no negociables durante F7–F10

1. **Un tema por PR** (`R-PR-2`, `R-AC-6`): puerto + adaptadores relacionados, o un
   caso de uso con sus pruebas; no todo el árbol a la vez.
2. **Contrato HTTP estable**: `/api/v1/**` no cambia por una reorganización interna;
   `G-5` y `G-8` permanecen verdes.
3. **Verde siempre**: `npm run build && npm run lint && MONGODB_MOCK=1 npm test`.
4. **Puertos antes que movimientos**: primero se define el contrato en el consumidor,
   luego se adapta infraestructura y finalmente se mueve la orquestación.
5. **Sin puentes permanentes**: un re-export temporal lleva deuda exacta, fecha y fase de
   retirada; F10 no admite excepciones.
6. **Documentación viaja con el código**: README, ADR si cambia una decisión y snapshot
   de auditoría se actualizan en el mismo PR.

## 7. Criterio de cierre

La arquitectura se declarará completada únicamente cuando se cumpla `R-HX-14` y estén
verdes:

```bash
npm run build
npm run lint
MONGODB_MOCK=1 npm test
npm run test:contract
npm run openapi:check
```

Además, el audit de arquitectura deberá mostrar cero puertos de negocio en
infraestructura, cero imports entre adaptadores y ningún workflow de negocio en
`apps/*`. Hasta F10, la etiqueta oficial es: **traslado físico completado, conformidad
hexagonal pendiente**.
