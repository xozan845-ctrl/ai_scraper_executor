# Decisiones de arquitectura (ADR) — AI Web Scraping Executor

Registro de decisiones técnicas **deliberadas**: aquellas donde había más de una
razonable y conviene recordar por qué se eligió esta. No es un catálogo de lo que
el código hace (eso está en [`rules/`](./rules/README.md)), sino el registro de las
decisiones que un futuro mantenedor podría cuestionar.

**Formato:** `ADR-NN`, con fecha, estado, contexto, decisión, consecuencias.
**Regla de oro:** una decisión que se cambia no se borra — se marca `Sustituido por
ADR-NN` y se añade el nuevo. El árbol de reglas tiene la misma regla (`R-COV-3`).

> Este archivo se reescribió el 2026-10-05. Las 15 ADRs anteriores describían otro
> proyecto (e-commerce con microservicios: dinero en centavos, roles logísticos,
> Angular, Dockploy) y **no** se conservan porque no describen ninguna decisión de
> este repositorio. No hay ninguna decisión de este repo que se haya perdido: la
> adaptación del árbol de reglas no cambió código, solo documentación.

---

## ADR-01: La IA decide QUÉ, el motor decide CÓMO (DSL de 15 comandos)

- **Fecha**: 2026-09-28
- **Estado**: Aceptado
- **Contexto**: Un agente que scrappea con un LLM tiene dos riesgos: que el modelo
  ejecute acciones arbitrarias sobre la máquina, y que la lógica de crawling se
  disperse entre prompts.
- **Decisión**: El LLM emite **exclusivamente** un plan en el DSL de 15 comandos
  (`libs/domain/ai/src/schemas.ts`), validado con Zod después de pasar por el
  normalizador. El motor (`ExecutionEngine`) interpreta esos comandos. La IA nunca
  ejecuta código: no hay eval, ni shell, ni acceso a ficheros.
- **Consecuencias**: (a) el prompt es pequeño y sus tokens son caros → presupuestados
  (`maxAiTokens`) y cacheados; (b) el cambio de modelo no cambia el formato de
  salida, así que el fallback entre modelos es trivial; (c) el motor es testeable sin
  LLM; (d) el coste de cada llamada al modelo es acotable antes de pagarla.

---

## ADR-02: Normalizar antes de validar, y validar igualmente estricto

- **Fecha**: 2026-09-28
- **Estado**: Aceptado
- **Contexto**: Un modelo débil no emite exactamente el esquema: pone `type` en
  minúsculas, inventa un comando, manda números como strings, añade campos de más.
  Rechazar el plan entero obliga a un reintento (caro); aceptarlo tal cual deja que
  un modelo haga lo que quiera con la validación.
- **Decisión**: Dos fases. `normalize.ts` **corrige** lo recuperable y **descarta** lo
  irrecuperable (un comando inventado se elimina, no se "arregla"); después, Zod
  valida el resultado con la misma dureza que si no hubiera normalizado.
- **Consecuencias**: la normalización es el único sitio donde se perdona al modelo,
  y es un sitio auditable y testeado (`tests/normalize.test.mjs`, `R-RB-1`). La
  validación no se ablanda: es la frontera de seguridad, no una sugerencia.

---

## ADR-03: `node --test` como runner, sin framework de test

- **Fecha**: 2026-09-28
- **Estado**: Sustituido por ADR-29 (objetivo: Vitest). **Vigente durante la migración**:
  mientras ADR-30 no cierre, el runner activo sigue siendo `node --test`.
- **Contexto**: La suite prueba 12 paquetes y 2 apps en JavaScript plano
  (`node_modules` con la compilación ya resuelta). Un framework (Jest/Vitest)
  exigiría `ts-jest` o una capa de transformación, configuración de cobertura por
  workspace, y una matriz de compatibilidades con Playwright y Crawlee.
- **Decisión**: el runner nativo de Node ≥20, con `tests/*.test.mjs` y sin
  dependencias. Sin `*.spec.ts`, sin `coverageThreshold` por paquete, sin `setup`
  global, sin watch mode.
- **Consecuencias**: (a) la suite arranca sin configuración ni transformaciones; (b)
  la cobertura se resolvió **después** con la herramienta nativa de Node
  (`--experimental-test-coverage`), sin añadir `c8`/`nyc` (ADR-17); al principio fue
  deuda declarada y hoy es `G-3` ✅; (c) el descubrimiento de ficheros se
  lista explícitamente en el script `test` de `package.json`, no por patrón
  automático: más verboso, pero exacto; (d) menos potencia (mocks, snapshots) a
  cambio de cero complejidad de build.

---

## ADR-04: La suite es serial (`--test-concurrency=1`)

- **Fecha**: 2026-10-01
- **Estado**: Aceptado
- **Contexto**: Crawlee usa **almacenamiento local en disco** para su estado. Al
  ejecutar los ficheros en paralelo, dos procesos escriben sobre el mismo storage y
  los fallos son intermitentes y no reproducibles.
- **Decisión**: `--test-concurrency=1` fijo en el script `test`, y por tanto también
  en CI.
- **Consecuencias**: la suite tarda ~24 s. A cambio, es determinista. Paralelizar
  exige primero aislar el almacenamiento de Crawlee; está normado en `R-FL-5` como
  deuda, no como mejora pendiente.

---

## ADR-05: Tres almacenes, cada uno para lo que mejor hace

- **Fecha**: 2026-09-28
- **Estado**: Aceptado
- **Contexto**: El sistema tiene tres clases de datos muy distintas: **datos
  estructurados de negocio** (jobs, sesiones, mensajes, comandos, resultados),
  **perfiles aprendidos de sitios** (HTML, hashes, perfiles de selectores, deriva) y
  **estado compartido y desechable** (caché de páginas, rate limit, métricas).
- **Decisión**:
  - **PostgreSQL + Prisma** para lo estructurado y transaccional (10 modelos, 2
    migraciones versionadas).
  - **MongoDB** para los perfiles de sitio y la radiografía: documentos que cambian
    de forma con el learning, sin esquema fijo.
  - **Redis** para caché, rate limit y agregación de métricas, con **fallback en
    memoria** y aviso por log.
- **Consecuencias**: (a) cada tipo de dato va a donde encaja, sin forzar un modelo
  relacional sobre HTML ni un documento gigante sobre un esquema; (b) tres fuentes
  de fallo más, mitigadas por fallbacks **avisados** — nunca fallos silenciosos
  (`R-MO-5`, `R-RD-5`); (c) tres piezas que desplegar (`docker-compose.yml`), con
  healthcheck y volúmenes nombrados.

---

## ADR-06: Fallback en memoria, siempre avisado

- **Fecha**: 2026-09-28
- **Estado**: Aceptado
- **Contexto**: En desarrollo y en CI no siempre hay Mongo o Redis levantados. La
  alternativa —fallar al arrancar— convertiría "no tengo Mongo" en "no puedo
  ejecutar ni un test".
- **Decisión**: MongoDB y Redis tienen implementación en memoria que se usa
  automáticamente si la conexión real no está. **Cada fallback escribe un log
  explícito** diciendo qué degradación ocurrió y por qué.
- **Consecuencias**: (a) la suite corre sin Docker (`MONGODB_MOCK=1` ni siquiera es
  imprescindible); (b) degradar nunca es silencioso — un despliegue que degradó a
  memoria se ve en el log, que es el punto; (c) el coste es que un fallo de
  infraestructura puede parecer un bug de lógica si solo se mira el resultado, no
  el log.

---

## ADR-07: SSRF centralizado en un único paquete

- **Fecha**: 2026-10-04
- **Estado**: Aceptado
- **Contexto**: El sistema pide URLs que **no controla el usuario**: vienen en la
  petición y las va a(fetch. Un hostname que resuelva a `169.254.169.254` o a un
  `localhost` del contenedor convierte la API en un proxy interno.
- **Decisión**: todo el filtrado vive en `packages/security` (`assertPublicUrl`,
  `isBlockedHost`, `isBlockedIp`, `isPrivateHostsAllowed`) y **ninguna otra capa
  reimplementa esa lógica**. La validación ocurre en el borde (comando y DTO) y
  **de nuevo** en el motor, porque entre la validación y la petición hay un LLM de por
  medio que puede proponer otra URL. Los redirects y los subrecursos del navegador se
  filtran igual que la navegación inicial.
- **Consecuencias**: (a) un hueco de SSRF es imposible de tener por descuido, porque
  no hay una segunda implementación que mantener al día; (b) el paquete no depende de
  nada y su suite es pura y rápida (`tests/security.test.mjs`,
  `tests/browser-ssrf.test.mjs`); (c) `ALLOW_PRIVATE_HOSTS` existe para el desarrollo
  local y es una decisión consciente de cada entorno.

---

## ADR-08: `0` no desactiva un presupuesto

- **Fecha**: 2026-10-02
- **Estado**: Aceptado
- **Contexto**: `maxAiTokens: 0` se lee intuitivamente como "sin límite". Con un
  LLM de pago, esa lectura es un incidente de coste.
- **Decisión**: `normalizeJobLimits` trata cualquier valor no finito o `<= 0` como
  **ausente** y toma `DEFAULT_LIMITS`; un valor válido se recorta a
  `[1, HARD_LIMITS[key]]`. `DEFAULT_LIMITS` y `HARD_LIMITS` viven en
  `libs/domain/execution`, y el recorte también se aplica a los límites de un comando
  (`clampCommandLimits`), de modo que el límite efectivo de un comando nunca supera
  el del job.
- **Consecuencias**: (a) los topes son del servidor, no del cliente: un DTO manipulado
  no agota recursos; (b) la semántica está documentada en el contrato de la API
  (`R-C-8`), porque un cliente que cree que `0` = infinito provocará el incidente;
  (c) los extremos de la función son caso de prueba (`tests/limits.test.mjs`).

---

## ADR-09: Credenciales de sesión cifradas en reposo, nunca devueltas

- **Fecha**: 2026-10-03
- **Estado**: Aceptado
- **Contexto**: Una sesión puede llevar cabeceras de autenticación del sitio objetivo
  (`Authorization`, `Cookie`). Son el dato más sensible que maneja el sistema y viven
  en la base de datos.
- **Decisión**: se cifran con **AES-256-GCM** usando `CREDENTIALS_KEY` antes de
  persistirse, y se descifran **solo en el worker**, en el momento de aplicarlas a la
  petición HTTP y al contexto del navegador. Ningún endpoint las devuelve (ni en claro
  ni cifradas), nunca aparecen en un log ni en una métrica, y sin `CREDENTIALS_KEY` la
  sesión con credenciales **se rechaza** en vez de almacenarse en texto plano.
- **Consecuencias**: (a) el secreto de un tercero no está en la base de datos de
  forma legible; (b) perder la clave implica perder las credenciales: es el compromiso
  explícito de no tener recuperación; (c) `CREDENTIALS_KEY` debe ser distinta por
  entorno (R-SE-12).

---

## ADR-10: Autenticación fail-closed

- **Fecha**: 2026-10-03
- **Estado**: Aceptado
- **Contexto**: `API_KEYS` es una lista separada por comas. El patrón habitual —
  "si no hay lista configurada, no compruebes"— convierte un olvido de despliegue en
  una API abierta.
- **Decisión**: en `NODE_ENV=production` **sin `API_KEYS`**, todas las rutas
  protegidas devuelven `401`. La ausencia de configuración en producción es un
  cierre, no una excepción. El arranque escribe un `error` explícito para que el
  operador no lo descubra en el primer `curl`. Además hay un segundo origen de claves
  (usuarios registrados, hasheadas con SHA-256), útil para el primer usuario, y la
  comparación es en tiempo constante (`timingSafeEqual`).
- **Consecuencias**: (a) un despliegue mal configurado se ve ruidosamente desde el
  primer minuto; (b) el `401` nunca dice *cuál* clave falló; (c) si la base de datos no
  responde al verificar una clave de usuario, el resultado es **no autorizado**, no
  una autorización por fallo.

---

## ADR-11: Híbrido HTTP/Cheerio primero, navegador solo si hace falta

- **Fecha**: 2026-09-28
- **Estado**: Aceptado
- **Contexto**: Playwright es necesario para JS y para `interact()`, y es carísimo:
  ~300 MB de navegador, ~1 s por arranque de contexto. La mayoría de las páginas se
  leen con una petición HTTP.
- **Decisión**: `ExecutionEngine` intenta primero `safeFetchText` + Cheerio. El
  navegador se lanza **solo** cuando el plan lo pide (`browserInteract`/`interact`) o
  cuando el HTML no contiene lo que el selector busca. El pool de navegadores se
  reutiliza entre jobs, con un semáforo de concurrencia.
- **Consecuencias**: (a) el coste por job cae drásticamente en el caso común; (b) el
  crawler necesita un **almacenamiento en disco**, que es la razón de la decisión
  ADR-04; (c) hay dos caminos de ejecución, y por eso el motor tiene tests
  separados para HTTP y para navegador.

---

## ADR-12: Dos imágenes, dos bases, por culpa de Chromium

- **Fecha**: 2026-10-01
- **Estado**: Aceptado
- **Contexto**: El worker necesita Chromium con sus dependencias de sistema
  (`playwright install --with-deps`); la API no.
- **Decisión**: `apps/api/Dockerfile` sobre `node:22-alpine` (pequeña) y
  `apps/worker/Dockerfile` sobre `node:22-bookworm-slim` con Chromium instalado.
  Ninguno declara `ARG`/`ENV` con credenciales: los secretos llegan en ejecución
  (`R-CD-7`).
- **Consecuencias**: la imagen de la API es mucho menor; la del worker es grande pero
  es la que lo necesita. La versión de Node en CI (`22`) coincide con la de las dos
  imágenes, así que un fallo no se debe a una diferencia de runtime.

---

## ADR-13: `npm ci --ignore-scripts` y Chromium explícito

- **Fecha**: 2026-10-01 (revisado 2026-10-05)
- **Estado**: Sustituido parcialmente por ADR-18 (retirada de `--legacy-peer-deps`)
- **Contexto**: el árbol de workspaces tenía conflictos de peer dependencies que
  npm rechazaba sin `--legacy-peer-deps`, y los `postinstall` de Playwright/Crawlee
  intentan descargar navegadores durante la instalación.
- **Decisión**: la instalación es **siempre** `npm ci --ignore-scripts`, en CI y en
  los Dockerfiles. Chromium se instala **explícitamente** donde hace falta
  (`Dockerfile` del worker, host del desarrollador para el E2E), nunca como efecto
  colateral de un `npm install`. La bandera `--legacy-peer-deps` se añadió entonces
  como paliativo de los conflictos.
- **Consecuencias**: (a) la instalación es determinista y rápida, y no descarga
  navegadores que la suite unitaria no usa (`R-EN-5`); (b) `--legacy-peer-deps` era
  deuda técnica explícita, y se **retiró en el ADR-18** cuando Nest 12 y eslint 10
  alinearon los peers. Hoy `npm ci --ignore-scripts` a secas es la norma.

---

## ADR-14: La suite unitaria no toca la red, ni la BD, ni el LLM

- **Fecha**: 2026-09-28
- **Estado**: Aceptado
- **Contexto**: Una suite que depende de la red es una suite que falla por causas que
  no son del código, y eso entrena al equipo a ignorar fallos.
- **Decisión**: `npm test` no abre conexión a Postgres, Mongo ni Redis, no llama a
  `fetch` real, no invoca a un LLM ni navega a un sitio. Todo se dobla
  (`MONGODB_MOCK=1`, proveedores falsos, `http.createServer` local para 4xx/5xx). Las
  capas con red real viven en otros comandos: `npm run test:e2e` (E2E con LLM y
  sitio reales) y `npm run test:api` (cliente real de la API).
- **Consecuencias**: (a) la suite es determinista y tarda ~24 s; (b) **el CI no puede
  comprobar nada que requiera infraestructura**, y por eso `G-4`, `G-5` y `G-6` son
  pendientes y no "verdes por Defaults"; (c) un cambio de prompt **no** se puede
  validar en la suite unitaria: por eso el E2E es gate de release y no de cada PR.

---

## ADR-15: Una rama, y la promoción declarada como deuda

- **Fecha**: 2026-10-05
- **Estado**: Aceptado (con deuda explícita)
- **Contexto**: El modelo heredado (`develop` → `staging` → `main` con promoción y
  smoke por entorno) describe un proceso de CD de tres etapas. Este repositorio tiene
  **una rama**, 58 commits y **0 merge commits**.
- **Decisión**: se norma el modelo real —`main` es la rama de integración, nada se
  escribe a mano en ella, el historial es lineal— y la promoción entre entornos se
  registra como **deuda declarada** (`R-GE-5`), no como norma vigente. No se inventa un
  ritual de `staging` que no existe.
- **Consecuencias**: (a) las reglas de git son ejecutables hoy; (b) quien quiera
  promover entre entornos escribe primero el job y la regla, no al revés
  (`R-CI-4`); (c) la protección de rama —que hoy no está configurada en el remoto— es
  la parte de esta decisión que falta cerrar.

---

## ADR-16: Parchear transitivas con `overrides`, no forzar majors

- **Fecha**: 2026-10-05
- **Estado**: Aceptado
- **Contexto**: `npm audit --audit-level=high` salía con código 1 (8 `high`):
  `@nestjs/platform-express` → `multer`, `@nestjs/swagger` → `js-yaml`/`lodash`,
  `prisma` → `deepmerge-ts`, y `http-cache-semantics`. `npm audit fix --force`
  proponía subir `@nestjs/platform-express` a 12.x y `@nestjs/swagger` a 12.x:
  cambios de versión **mayor** que arrastran `@nestjs/core`/`@nestjs/common` y, con
  ellos, la API entera.
- **Decisión**: no forzar majors. Se fija la versión parcheada de cada transitiva
  desde el `package.json` raíz con `overrides` (`multer ^2.3.0`,
  `http-cache-semantics ^4.2.1`, `deepmerge-ts ^8.0.0`, `js-yaml ^4.3.2`,
  `lodash ^4.18.1`, `body-parser ^1.20.8`, `qs ^6.16.0`, `file-type ^21.3.4`),
  todas dentro de su mismo rango mayor salvo `deepmerge-ts` (7 → 8, cuya API de
  merge es compatible y se verificó con `prisma generate`/`validate`) y `file-type`
  (20 → 21). Y se añade el paso **`Security audit`** (`npm audit --audit-level=high`)
  al job `build-test-lint`, que ahora **bloquea**.
- **Consecuencias**: (a) la puerta pasó a **exit 0** sin tocar la versión de Nest ni
  el código de la aplicación; (b) `overrides` es una deuda viva: hay que revisarla
  cuando las dependencias que las arrastran se actualicen, y quitarla en cuanto la
  transitiva sana llegue por su cuenta; (c) quedaba **1 moderate** (`@nestjs/core`
  `<=11.1.17`), que exigía subir Nest de major; se declaró y no se silenció, y se
  cerró en el **ADR-18** (Nest 12). Ver
  [`rules/test/07-qa-gates.md`](./rules/test/07-qa-gates.md) (`R-QA-6`) y
  [`rules/_meta/AUDIT.md`](./rules/_meta/AUDIT.md).

> **Revisión 2026-10-06 (mantenimiento del `overrides`):** tras Nest 12 y eslint 10,
> se comprobó que **7 de los 8 overrides ya no eran necesarios**: con ellos fuera, la
> única vulnerabilidad `high` que reaparece es `deepmerge-ts <8.0.0` (vía
> `@prisma/config`). Los demás (`multer`, `qs`, `body-parser`, `http-cache-semantics`,
> `js-yaml`, `lodash`, `file-type`) ahora los resuelven las versiones parcheadas de
> sus padres (`@nestjs/platform-express@12` fija `multer@2.4.0`, express 5 fija
> `body-parser@2.3.0`/`qs@6.16.0`, eslint 10 usa `js-yaml@5`, crawlee usa
> `lodash@4.18.1` y `file-type@21.3.4`). El bloque queda reducido a
> **`deepmerge-ts: ^8.0.0`**. Revisar de nuevo cuando `@prisma/config` empaquete
> `deepmerge-ts >= 8`.

---

## ADR-17: Cobertura con la herramienta nativa de Node, umbral del baseline

- **Fecha**: 2026-10-05
- **Estado**: Sustituido por ADR-29 (objetivo: cobertura de Vitest). **Vigente hasta
  que ADR-30 migre el runner**; hoy el umbral sigue midiéndose con la herramienta nativa.
- **Contexto**: `G-3` estaba `⏸` porque no había herramienta de cobertura y no se
  quería inventar un umbral. Las opciones eran añadir `c8`/`nyc` (dependencia nueva)
  o usar la cobertura nativa de Node ≥22 (`--experimental-test-coverage` +
  `--test-coverage-lines/branches/functions`), que **ya falla el run** si no se
  alcanza el umbral.
- **Decisión**: usar la herramienta nativa, sin dependencias nuevas. El alcance es
  el **build** (`packages/*/dist`, `apps/*/dist`), porque los tests importan `dist`
  (ADR-03) y es un transpile 1:1 de `src`; se excluyen módulos de DI, `main` y DTOs.
  Baseline medido: **71.59 / 73.69 / 68.90**; umbral = base redondeada a la baja con
  1 punto de margen → **70 / 72 / 67**, fijado en el propio script `test`.
- **Consecuencias**: (a) `G-3` pasa a ✅ y `npm test` (y por tanto el job
  `build-test-lint`) bloquea si la cobertura baja; (b) cero dependencias nuevas y
  cero configuración extra; (c) límite honesto: Node solo cuenta ficheros que la
  suite **carga**, así que un fichero nunca importado no arrastra el porcentaje —
  eso lo cubre `R-COV-2`/`R-U-17`, no el gate; (d) el umbral sube +5 por release
  (`R-COV-5`), nunca baja.

---

## ADR-18: Nest 10 → 12, eslint 10 y retirada de `--legacy-peer-deps`

- **Fecha**: 2026-10-05
- **Estado**: Aceptado
- **Contexto**: quedaban dos conflictos de peer que obligaban a `--legacy-peer-deps`
  (ADR-13) y un `moderate` de `@nestjs/core <=11.1.17`: (a) `apps/api` en Nest 10
  mientras `@nestjs/mongoose@12` exige Nest `^11 || ^12`; (b) `@eslint/js@10` con
  `eslint@9`.
- **Decisión**: subir `apps/api` a **Nest 12** (`@nestjs/common`, `@nestjs/core`,
  `@nestjs/platform-express` `^12.1.2`, `@nestjs/swagger` `^12.0.2`) y `eslint` a
  `^10.12.0`. Con eso los peers alinean y **se retira `--legacy-peer-deps`** de CI y
  de los dos Dockerfiles. El `overrides` de `multer` se mantiene (platform-express 12
  ya fija `2.4.0`, coincide).
- **Consecuencias**: (a) `npm audit` pasa a **0 vulnerabilidades** (desaparece el
  moderate); (b) la instalación es `npm ci --ignore-scripts` a secas y vuelve a ser
  una resolución de peers honesta; (c) Nest 12 trae **Express 5** (routing con
  `path-to-regexp` 8), así que cualquier `@Get`/`@Post` nuevo debe usar la sintaxis
  de Express 5; la API actual (solo controllers Nest, sin rutas comodín raras) migra
  sin cambios; (d) `eslint` 10 no cambió el resultado en ese momento: 0 errores,
  20 warnings (los warnings se limpiaron después, al incluir `scripts/` en el lint).

  > **Nota (2026-10-05):** Nest 12 trajo dos regresiones de runtime que la suite
  > unitaria no veía (no levanta la app): el driver HTTP no se autodetectaba y el
  > comodín `:url(*)` ya no valía en Express 5. Se corrigieron en
  > `fix(api): arrancar con Nest 12/Express 5` (adaptador explícito y `*url`). Es la
  > razón por la que `G-4`/`G-6` importan.

---

## ADR-19: Spec OpenAPI versionada y artifact de test

- **Fecha**: 2026-10-05
- **Estado**: Aceptado
- **Contexto**: `G-8` (Swagger sincronizado) estaba `⏸` y `R-EN-3` (artifacts) no
  tenía nada que subir. La spec se generaba solo en runtime en `/api/v1/docs`.
- **Decisión**: versionar la spec en `docs/openapi.json` y verificarla en CI con
  `npm run openapi:check`: el script `scripts/check-openapi.mjs` **arranca la API
  compilada**, pide `/api/v1/docs-json`, canonicaliza (claves ordenadas) y compara;
  `npm run openapi:export` la reescribe. Además, el reporter JUnit de Node escribe
  `test-results.xml` (gitignorado) en cada `npm test`, y CI lo sube como artifact en
  todos los runs (`if: always()`).
- **Consecuencias**: (a) `G-8` pasa a ✅: un DTO o ruta cambiada sin re-exportar la
  spec falla el job; (b) `R-EN-3` pasa a ✅; (c) el check ejercita el **arranque real**
  de la API, que es justo lo que la regresión de Nest 12/Express 5 puso de relieve;
  (d) la comparación es de la spec canonicalizada, así que no hay falsos positivos
  por orden de claves.

---

## ADR-20: Property-based con `fast-check`; mutation testing diferido a propósito

- **Fecha**: 2026-10-05
- **Estado**: Aceptado
- **Contexto**: `R-PB-*` (property-based) y `R-MT-*` (mutation) estaban como
  aspiracionales. Las funciones puras que procesan la entrada no confiable del
  modelo (DSL, presupuestos) y la derivación de dominios son candidatas ideales a
  propiedades. Para mutación, Stryker 10 solo ofrece runners jest/vitest/tap y los
  tests cargan `dist` con `node --test` (ADR-03).
- **Decisión**: instalar **`fast-check`** y escribir `tests/property.test.mjs`
  dentro de `npm test` (invariantes de `normalizeJobLimits`, `normalizeRawCommand`/
  `normalizeRawPlan` y `normalizeDomain`/`isAllowedHost`). **Diferir mutation
  testing** de forma explícita: no se añade Stryker porque exigiría mutar `dist` o
  un runner que el repo evita.
- **Reevaluación 2026-10-06**: al cerrar `G-4`/`G-5` se revisó el disparador. **Sigue
  diferido**: cerrar capas de test no cambia el runner, que sigue siendo `node --test`
  (no soportado por Stryker). El disparador real es **adoptar un runner soportado**
  (jest/vitest/tap como framework), lo que ADR-03 evita a propósito; hacerlo exigiría
  enmendar ADR-03. Se añade `tests/dsl-completeness.test.mjs` como cobertura parcial
  del DSL (`R-AI-2`).
- **Consecuencias**: (a) los property tests **encontraron tres defectos reales** que
  los casos fijos no veían: `normalizeJobLimits(5e-324) → 0` (fuera de `[1, HARD]` y
  no idempotente), la resolución de alias contra el prototipo (`__proto__`,
  `constructor`, `_ proto _` → `__proto__`) que colaba comandos inexistentes, y
  `normalizeDomain` no idempotente (dejaba un espacio); los tres corregidos
  (`R-REG-1`); (b) el ADR-03 (sin transform runner) sigue en pie; (c) la
  mutación queda documentada, con su disparador, en `R-MT-1`.

---

## ADR-21: Capas de test completas — contrato e integración en CI, E2E de release

- **Fecha**: 2026-10-05
- **Estado**: Aceptado
- **Contexto**: `G-4` (integración), `G-5` (contrato) y `G-6` (E2E) eran las capas
  que faltaban. El E2E ya existía (`tests/e2e-sevasa.test.mjs`) pero solo se corría a
  mano.
- **Decisión**:
  - **`G-5` contrato**: `tests/contract.test.mjs` arranca la API compilada (memoria,
    sin infra) y valida las formas de `/api/v1/**`; es el paso `Contract` de
    `build-test-lint`.
  - **`G-4` integración**: `tests/integration.test.mjs` con Postgres/Mongo/Redis
    reales (job `integration` del `ci.yml`, con servicios efímeros); cubre el ciclo
    de vida del job, la idempotencia, la persistencia real y una escritura/lectura
    en Mongo. Se **salta** si no hay infra, para que `npm test` no dependa de Docker.
  - **`G-6` E2E**: workflow [`e2e.yml`](../.github/workflows/e2e.yml) en
    `release`/`workflow_dispatch`, con servicios reales, Chromium y el secret
    `OPENROUTER_API_KEY`; es el segundo workflow aceptado por `R-CI-4`.
- **Consecuencias**: (a) `G-4`/`G-5`/`G-6` pasan a ✅ (configurados y verificados
  localmente; su evidencia de run verde de CI llega con el primer push, `R-COV-3`);
  (b) `npm test` sigue siendo rápido y sin infra (`R-QA-2`) porque contrato e
  integración son comandos aparte; (c) el E2E cubre lo que ninguna otra capa puede:
  que el modelo siga emitiendo el DSL contra un sitio real (ADR-14).

---

## ADR-22: Release por tag con imágenes en GHCR

- **Fecha**: 2026-10-06
- **Estado**: Aceptado
- **Contexto**: `R-CD-1..8` eran el contrato de un pipeline de release que no existía
  (no había `release.yml` ni publicación de imágenes). El despliegue real es
  `docker compose` desde el commit de `main`, sin inmutabilidad por tag.
- **Decisión**: añadir `.github/workflows/release.yml` que implementa el contrato:
  - se dispara en el **push de un tag** `v<major>.<minor>.<patch>(-prerelease)` o a
    mano; `workflow_dispatch` trae **`dry_run: true`** por defecto (`R-CD-8`);
  - un job `validate` comprueba el formato del tag y la **procedencia** (el commit
    etiquetado está en `main` **y** tiene un run de `ci` verde en ese SHA) (`R-CD-1`,
    `R-CD-2`);
  - un job `images` (matriz `api`/`worker`) construye una vez con `docker build`,
    etiqueta con `org.opencontainers.image.*` + semver + `sha-<corto>` + `latest`
    (solo no-prerelease), y publica en **GHCR** con el `GITHUB_TOKEN` (`packages:
    write`); el digest queda en el resumen del run (`R-CD-3`, `R-CD-4`);
  - los Dockerfiles no llevan `ARG`/`ENV` con credenciales (`R-CD-7`).
- **Consecuencias**: (a) `R-CD-1..4`, `R-CD-7` y `R-CD-8` quedan implementados;
  (b) el **tag se corta después de que el E2E (`G-6`) esté verde** — el release no
  reejecuta el E2E, lo asume como puerta previa; (c) `R-CD-5` (migraciones hacia
  adelante) sigue siendo responsabilidad del despliegue (`migrate deploy`), no del
  release; (d) `R-CD-6` (aprobación de producción) sigue siendo el merge verificado a
  `main`, porque no hay entornos separados (`R-GE-5`).

---

## ADR-23: Separación opt-in de Redis para la cola (`QUEUE_REDIS_URL`)

- **Fecha**: 2026-10-06
- **Estado**: Aceptado
- **Contexto**: `R-RD-1` describía la cohabitación de Redis (cola BullMQ + caché +
  rate limit + métricas) como deuda: un `FLUSHALL` de mantenimiento tumba los jobs en
  vuelo. La separación «definitiva» se anunciaba como cambio normativo con ADR.
- **Decisión**: soportar una instancia propia para la cola sin romper el default:
  - `queueRedisUrl()` (en `packages/queue`) usa `QUEUE_REDIS_URL` si está definida y no
    vacía; si no, `REDIS_URL`. La usan `createJobQueue` (API) y el consumidor BullMQ
    del worker.
  - `docker-compose.yml` trae un servicio `redis-queue` bajo el **perfil** `split-redis`
    (no arranca en el `up` por defecto) y pasa `QUEUE_REDIS_URL` a `api`/`worker`
    (por defecto `redis://redis:6379`, es decir, la instancia compartida).
  - `QUEUE_REDIS_URL` queda en `.env.example` (vacío) y `.env.production.example`
    (instancia separada recomendada).
- **Consecuencias**: (a) el default no cambia (una sola instancia, familias separadas
  por prefijo `R-RD-2`); (b) en producción se recomienda y documenta la instancia
  separada; (c) queda pendiente del operador activar el perfil y fijar la variable —el
  repo soporta la separación, no la impone—, por lo que la deuda se degrada de
  «imposible» a «decisión de despliegue».

---

## ADR-24: Stack de observabilidad local (Prometheus + Grafana)

- **Fecha**: 2026-10-06
- **Estado**: Aceptado
- **Contexto**: `R-TM-*` exige métricas con prefijo `scraper_`, dashboard y alertas,
  pero el repo no provisionaba nada: el «dashboard» era el SPA de `/api/v1/dashboard`.
- **Decisión**: añadir `infra/observability/` (scrape de Prometheus del endpoint
  `/api/v1/metrics/prometheus` + datasource y dashboard de Grafana con las métricas
  reales) y un override [`docker-compose.observability.yml`](../docker-compose.observability.yml)
  que levanta Prometheus y Grafana sobre el compose base. El stack arranca la API con
  `API_KEYS` vacío para que el scrape funcione sin cabecera.
- **Consecuencias**: (a) hay un dashboard reproducible con las métricas del proyecto;
  (b) **no** es el stack de producción: allí el endpoint exige `x-api-key` (`R-TM-7`) y
  el scrape debe llevar el secreto fuera del repo; (c) las **reglas de alerta**
  (`R-TM-5`/`R-TM-9`) siguen siendo un contrato no provisionado — se dejan como deuda
  explícita.

---

## ADR-25: Puertos publicados del compose configurables por entorno

- **Fecha**: 2026-10-06
- **Estado**: Aceptado
- **Contexto**: un despliegue en Dokploy falló al arrancar `api`: el compose publicaba
  puertos **fijos** en el host (`3000`, y `5432`/`27017`/`6379`), y en un host
  compartido el `3000` ya estaba asignado por otro servicio
  (`Bind for 0.0.0.0:3000 failed: port is already allocated`).
- **Decisión**: los puertos del host pasan a ser configurables con default local:
  `API_PORT` (3000), `POSTGRES_PORT` (5432), `MONGODB_PORT` (27017) y `REDIS_PORT`
  (6379). El lado del contenedor no cambia; las URLs internas siguen resolviendo por
  nombre de servicio. Documentado en `cd/02-entornos.md` y en las plantillas de
  entorno.
- **Consecuencias**: (a) un despliegue en host compartido fija cada `*_PORT` a un
  puerto libre (o no publica `API_PORT` y deja que el proxy enrute a `api:3000`);
  (b) el desarrollo local no cambia (usa los defaults); (c) el `HEALTHCHECK` del
  contenedor y los healthchecks de los almacenes siguen midiendo el puerto interno.

---

## ADR-26: Sincronización obligatoria entre documentación y código (R-DO-8)

- **Fecha**: 2026-10-08
- **Estado**: Aceptado
- **Contexto**: la documentación ya se trataba como código (área `documentation/`),
  pero las obligaciones eran **granulares**: `R-DO-1` solo cubría paquetes/apps
  nuevos, `R-DO-2` la topología, `R-DO-3` el entorno y `R-DO-6` el contrato. Ninguna
  regla obligaba a actualizar el README de un módulo cuando cambiaba su lógica. La
  prueba es el propio árbol: al revisarlo aparecieron documentos desfasados — el root
  `README.md` decía 143 tests y `AGENTS.md` 149 cuando la suite tenía 153;
  `dockploy-setup.md` afirmaba que no existía `release.yml`; `R-PR-6` describía como
  inexistentes checks que ya corrían en `ci.yml`. Corregir el síntoma (un PR de
  consistencia) no impide que la deriva vuelva a ocurrir.
- **Decisión**: añadir **`R-DO-8`** — todo cambio de lógica en `apps/*` o `packages/*`
  se entrega con el `README.md` del módulo actualizado en el mismo PR si altera algo
  que éste documenta (responsabilidad, superficie pública, comandos, dependencias,
  recuento de tests); si el cambio **no** altera nada documentado, el PR lo **declara**
  en el `CHECKLIST`. La regla generaliza las específicas sin sustituirlas.
- **Consecuencias**: (a) la sincronización deja de depender de la memoria del autor: es
  un ítem de revisión de PR, no una recomendación; (b) **no** se puede gatear
  mecánicamente en CI —qué documenta un README no es computable de forma general—, así
  que su evidencia es el `CHECKLIST` marcado, igual que el resto de `R-DO`; lo
  automatizable sigue cubierto por `G-8` (OpenAPI) y `G-9` (migraciones); (c) un
  refactor sin cambio documentable no fuerza un update vacío: el autor **declara** la
  ausencia de cambio, que es información útil para el revisor; (d) las reglas
  específicas `R-DO-1`/`R-DO-2`/`R-DO-3`/`R-DO-6` conservan su alcance.

---

## ADR-27: Arquitectura hexagonal por dominios — `apps/` + `libs/{domain,application,infrastructure,shared}`

- **Fecha**: 2026-10-09
- **Estado**: Aceptado
- **Contexto**: el modelo vigente de «5 capas» (`R-AR-2`) es una **vista de runtime**
  (interface→orquestación→inteligencia→ejecución→datos) útil para explicar el flujo de
  un job, pero **no** impone una dirección de dependencia verificable: nada impide que
  `packages/ai` importe Prisma o que un adaptador se mezcle con la lógica de negocio. El
  dominio (DSL, límites, máquina de estados, reglas de scraping) no puede probarse sin
  infraestructura y cambiar un proveedor de LLM o de persistencia obliga a tocar código
  de negocio. Con el producto creciendo, se necesita una separación explícita entre
  **qué** sabe el negocio y **cómo** se ejecuta.
- **Decisión**: el objetivo del monorepo es **arquitectura hexagonal (puertos y
  adaptadores) organizada por bounded contexts**, con cuatro capas internas bajo `libs/`
  y las apps como **composition root**:

  | Capa | Ruta | Contiene | No puede importar |
  |---|---|---|---|
  | Dominio | `libs/domain/<contexto>` | entidades, value objects, servicios puros, **puertos** (interfaces) | nada de otras capas, ni frameworks/SDKs |
  | Aplicación | `libs/application/<contexto>` | casos de uso, DTOs; coordina puertos | `infrastructure`, `apps` |
  | Infraestructura | `libs/infrastructure/<adaptador>` | adaptadores concretos que implementan puertos | — (implementa) |
  | Compartido | `libs/shared/<utilidad>` | utilidades puras transversales (core, observability, config, contracts) | domain/application/infrastructure |
  | Apps | `apps/api`, `apps/worker` | entry points y **composition root** (inyecta adaptadores) | — |

  Este modelo **sustituye** a las «5 capas» como modelo canónico: `R-AR-2` pasa a
  describir el mapeo histórico y delega en `R-HX-1`
  (`rules/architecture/03-arquitectura-hexagonal.md`). El mapeo paquete→lib vive en
  [`migracion-arquitectura.md`](./migracion-arquitectura.md).
- **Consecuencias**: (a) el dominio se prueba **sin base de datos, red ni LLM**
  (`R-QA-2` sigue vigente y se refuerza); (b) cambiar de proveedor de LLM o de
  persistencia es añadir un adaptador en `infrastructure/`, no tocar el negocio
  (generaliza `R-AR-7`); (c) las fronteras se vuelven **verificables** por lint
  (ADR-28); (d) hay un coste de migración real (mueve ficheros, cambia imports y
  nombres de paquete) que se amortiza con ADR-30; (e) durante la migración conviven
  `packages/` y `libs/` — un paquete no migrado conserva su ruta (`R-HX-9`); (f) las
  reglas que citan rutas `packages/*` se actualizan **por paquete** cuando éste migra,
  no en bloque.

---

## ADR-28: Gobernanza de fronteras con `eslint-plugin-boundaries` (sin Nx/Turborepo)

- **Fecha**: 2026-10-09
- **Estado**: Aceptado
- **Contexto**: la propuesta de arquitectura sugería **Nx** o **Turborepo**. Ambos
  aportan cache y `affected`, pero introducen un orquestador nuevo que reescribe el
  orden de build (`R-AR-4`), los scripts de CI (`R-CI-5`) y la resolución de `paths` de
  `tsconfig.base.json`. El problema real que hay que resolver **hoy** no es el tiempo de
  build: es que las fronteras entre capas (ADR-27) se puedan **violar sin que nada
  falle**.
- **Decisión**: mantener **npm workspaces** como orquestador y hacer cumplir las
  fronteras con **`eslint-plugin-boundaries`** (o equivalente): cada lib se etiqueta con
  su capa (`domain`, `application`, `infrastructure`, `shared`) y las aristas prohibidas
  de `R-HX-2` se declaran como reglas de import. Un import que cruce la frontera **falla
  `npm run lint`** (`G-7`), igual que un error de tipos. **No** se adopta Nx ni
  Turborepo en este paso.
- **Consecuencias**: (a) no se reescribe build ni CI; el `G-7` que ya existe pasa a
  cubrir también las fronteras; (b) se renuncia temporalmente a `affected`/cache de
  tareas (deuda declarada, no bloqueante: el build tarda poco); (c) el día que el tiempo
  de build lo justifique, se evalúa Nx/Turbo **con un ADR nuevo** que sustituya a éste;
  (d) las etiquetas de capa viven en la config de eslint y son la fuente de verdad de
  `R-HX-4`.

> **Revisión 2026-10-09 (mismo día, al implementar F0):** `eslint-plugin-boundaries@7`
> arrastra `handlebars` y `micromatch`/`braces` con **4 high + 1 critical**, lo que
> **rompe `R-QA-6`** (0 vulnerabilidades) y el paso `Security audit` de CI. Se descarta
> el plugin y se implementa el **equivalente** que el propio ADR admitía: un verificador
> propio, [`scripts/check-boundaries.mjs`](../scripts/check-boundaries.mjs), **sin
> dependencias**, que resuelve las capas por ruta/paquete y aplica la matriz de `R-HX-2`.
> Se ejecuta dentro de `npm run lint` (`npm run boundaries:check`), así que `R-HX-4`
> sigue anclada al gate `G-7` y `npm audit` permanece en **0**. Las regiones legacy
> (`ai→redis`) se tolera como excepción declarada por ruta
> `packages/…`, de modo que desaparecen solas al migrar a `libs/` (ADR-30). El resto de
> la decisión (npm workspaces, sin Nx/Turbo) no cambia.

---

## ADR-29: Vitest como runner de tests (sustituye ADR-03 y ADR-17)

- **Fecha**: 2026-10-09
- **Estado**: Aceptado (objetivo; la migración la ejecuta ADR-30)
- **Contexto**: la propuesta de arquitectura recomienda **Vitest** (o Jest). El runner
  actual, `node --test` (ADR-03), funciona y no tiene dependencias, pero: (a) obliga a
  mantener los tests en `.mjs` cargando el **build** (`dist`), lo que impide co-locarlos
  con el dominio y probar unidades de `src`; (b) su cobertura nativa (ADR-17) solo
  cuenta ficheros cargados; (c) no tiene runner para Stryker, que es justo el disparador
  que mantiene el mutation testing diferido (`R-MT-1`, ADR-20).
- **Decisión**: adoptar **Vitest** como runner objetivo. Vitest transforma TypeScript
  con esbuild, permite **co-locar** los tests (`libs/**/*.test.ts`) o mantenerlos en
  `tests/`, y desbloquea el runner de Stryker. La cobertura pasa a Vitest con umbrales
  re-medidos (`G-3`); los umbrales no bajan. **ADR-03 y ADR-17 quedan sustituidos** en
  cuanto ADR-30 complete la migración; durante la transición el runner activo sigue
  siendo `node --test` y los comandos `test:contract`/`test:integration`/`test:e2e`
  pueden seguir en Node hasta migrar su capa.
- **Consecuencias**: (a) los tests existentes (`.test.mjs`) pueden ejecutarse bajo
  Vitest **sin reescribirlos a la vez**, lo que permite migrar por capas; (b) el área
  [`rules/test/`](./rules/test/README.md) se enmienda **cuando** el runner cambie, no
  antes (hoy sus reglas describen `node --test`, que es la realidad vigente); (c)
  `R-MT-1` deja de estar bloqueado por el runner y se re-evalúa (su disparador se
  cumple); (d) se añade Vitest a `devDependencies` y se reescriben los scripts `test*` y
  la matriz de cobertura; (e) ninguna regla `R-U`/`R-COV` se renombra: se ajusta su
  texto al nuevo runner.

---

## ADR-30: Migración incremental (strangler) hacia `libs/`

- **Fecha**: 2026-10-09
- **Estado**: Aceptado
- **Contexto**: reestructurar 12 paquetes + 2 apps de una sola vez (big-bang) produce
  un PR enorme, imposible de revisar y con riesgo alto de romper el build/CI, justo lo
  que `R-PR-2` y `R-AC-3` prohíben.
- **Decisión**: migrar con **estrangular incremental**: cada PR mueve **un** paquete (o
  bounded context) a su ruta en `libs/`, recablea sus imports y sus `paths`, y deja
  `npm run build && npm run lint && MONGODB_MOCK=1 npm test` en verde. Mientras un
  paquete no haya migrado, **conserva su ruta `packages/<x>` y sus imports**
  (`R-HX-9`): el repo permanece verde en todo momento. `packages/` desaparece cuando
  migre el último; entonces se retira de `workspaces`, `tsconfig.base.json` y el lint.
  Las fases y el orden viven en
  [`migracion-arquitectura.md`](./migracion-arquitectura.md).
- **Consecuencias**: (a) cada PR es revisable y reversible; (b) existe una ventana en la
  que `tsconfig.base.json` mapea **ambas** rutas (`packages/*/dist` y `libs/*/dist`) —
  deuda explícita y temporal, no permanente; (c) los READMEs de módulo (`R-DO-1`,
  `R-DO-8`) viajan con cada movimiento; (d) el nombre del paquete puede cambiar
  (`@ai-scraper/core` → `@ai-scraper/<capa>-<contexto>`, `R-HX-6`), lo que obliga a
  actualizar imports de forma coordinada **en el mismo PR**; (e) ADR-29 (Vitest) y las
  reglas `R-HX` se cierran a medida que avanza la migración, no antes.

---

## Deudas que estos ADR dejan abiertas

| Deuda | ADR relacionado | Dónde está registrada |
|---|---|---|
| `overrides` de transitivas (hoy `deepmerge-ts`; revisar al actualizar `prisma`) | ADR-16, ADR-18 | `rules/ci/02-entorno.md`, `rules/_meta/AUDIT.md` |
| Cobertura solo de ficheros cargados por la suite | ADR-17 | `rules/test/06-estandares-cobertura.md` (`R-COV-4`) |
| Almacenamiento de Crawlee impide paralelizar la suite | ADR-04, ADR-11 | `rules/test/05-reglas-robustez.md` (`R-FL-5`) |
| Mutation testing diferido (runner incompatible) | ADR-20 | `rules/test/05-reglas-robustez.md` (`R-MT-1`) |
| Promoción entre entornos sin implementar | ADR-15 | `rules/git/00-entornos.md` (`R-GE-5`) |
| Separación caché/cola de Redis: soportada pero **opt-in** (default compartido) | ADR-23 | `rules/db/03-redis.md` (`R-RD-1`) |
| Retención de `Page`/`Command`/`AIInteraction` sin declarar | — | `rules/data/01-integridad.md` (`R-DI-8`) |
| Migración a hexagonal DDD **declarada pero no ejecutada** (conviven `packages/` y `libs/`) | ADR-27, ADR-30 | `migracion-arquitectura.md`; `rules/architecture/03-arquitectura-hexagonal.md` (`R-HX-9`) |
| Fronteras activas (script `scripts/check-boundaries.mjs`) con **1 excepción legacy** (`ai→redis`) | ADR-28, ADR-30 | `rules/architecture/03-arquitectura-hexagonal.md` (`R-HX-4`) |
| Runner **Vitest** decidido pero aún no migrado (`node --test` vigente) | ADR-29 | `rules/test/README.md` |
| Sin cache/`affected` de tareas (Nx/Turborepo evaluables más adelante) | ADR-28 | `docs/decisiones.md` (ADR-28) |

> El estado vigente de cada deuda, con el comando que la mide, está en
> [`rules/_meta/AUDIT.md`](./rules/_meta/AUDIT.md).
