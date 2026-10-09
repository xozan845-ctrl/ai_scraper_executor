# 07 — Política de QA y puerta de seguridad

Aplica a lo que el pipeline exige **como política global**, más allá de la forma de
escribir un test concreto. Complementa
[`01-reglas-unit.md`](./01-reglas-unit.md)…[`06-estandares-cobertura.md`](./06-estandares-cobertura.md)
sin repetirlas: aquí vive lo que decide si un cambio puede entrar.

> **Estado de cumplimiento de este repo: SÍ.** `R-QA-6` / `R-SE-16` exigen
> `npm audit --audit-level=high` como paso bloqueante del pipeline: ya existe
> (`Security audit` en el job `build-test-lint`) y sale con **código 0**. Desde
> Nest 12, `npm audit` reporta **0 vulnerabilidades** (también en moderate); el
> detalle está en [`../_meta/AUDIT.md`](../_meta/AUDIT.md). Las reglas de este
> archivo son permanentes: su cumplimiento es lo que cambia, no ellas.

## Reglas

| ID | Regla |
|---|---|
| R-QA-1 | **La cobertura es un gate medido, no un número inventado**. Cuando exista la herramienta, la cobertura se calcula automáticamente en el pipeline y el pipeline **falla** si no alcanza el umbral vigente (`R-COV-5`). El umbral se fija midiendo el baseline real con el alcance de `R-COV-4`; queda prohibido fijar un 80 % por analogsía con otro proyecto. **Excepciones explícitas y nombradas**: los ficheros excluidos del alcance (bootstrap, wiring de DI, DTOs, mocks) y las suites que aún no existen; cada excepción dice qué es y por qué, y ninguna se añade sin escribirla aquí y en `AUDIT.md`. |
| R-QA-2 | **Las pruebas unitarias no tocan infraestructura real.** `npm test` no abre conexión a Postgres, MongoDB ni Redis, no llama a `fetch` real, no invoca a un LLM y no navega a un sitio. Todo eso se dobla: `MONGODB_MOCK=1`, proveedores falsos, `http.createServer` local para el 4xx/5xx. La suite arranca en segundos y su resultado no depende de la red ni de Docker. |
| R-QA-3 | **La integración y el E2E son las únicas capas con permiso para la red real**, y se orquestan con `docker compose` (`docker compose up -d postgres mongodb redis`, exactamente los servicios que nombra `npm run dev:e2e`). Se ejecutan en un entorno limpio y **no dejan estado residual**: los jobs creados para la prueba se relanzan o se purgan, y el almacenamiento local de Crawlee no se comparte entre ejecuciones. Sin esa higiene, el segundo fallo siempre es un falso positivo. |
| R-QA-4 | **Los caminos de error son tests obligatorios, no opcionales.** Un endpoint probado solo en el camino feliz está mal probado. Hay que forzar y comprobar, como mínimo: entrada que el DTO rechaza (`400` por `ValidationPipe`), clave ausente o incorrecta (`401`, con el cuerpo que no filtra *cuál* falló — `R-SE-10`), exceso de rate limit (`429` con `X-RateLimit-*` — `R-SE-15`), **target inalcanzable o malformado** (no debe dejar el job colgado: terminal con `JobError` — `R-AI-14`), **respuesta del LLM inválida** (JSON roto, `type` inventado: plan inválido o normalizado, nunca excepción sin capturar — `R-RB-1`), y **petición que el SSRF debe rechazar** (`R-SE-4`). La respuesta debe ser accionable y sin stack (`R-C-10`). |
| R-QA-5 | **Aislamiento total entre casos.** Cada `test(...)` prepara su estado y no hereda nada del anterior. Consecuencia práctica en este repo: la concurrencia está fijada a **1** (`fileParallelism: false`) porque Crawlee usa almacenamiento en disco y en paralelo los ficheros se contaminan (`R-FL-5`) — paralelizar exige primero aislar ese storage, y hasta entonces el aislamiento se compra con serialidad, no con `t.afterEach()`. No se dejan artefactos: ni ficheros, ni variables de entorno mutadas, ni puertos ocupados. |
| R-QA-6 | **Puerta de seguridad en el pipeline**: el pipeline ejecuta `npm audit --audit-level=high` como paso **bloqueante** previo a la entrega. Si hay vulnerabilidades high o críticas sin resolver, el pipeline falla (`R-DS-7`, `R-SE-16`). No se sube el umbral a `moderate` para disimular, no se añade `--force`, y no se acepta el paso ausente: **`npm audit` en rojo significa repositorio fuera de cumplimiento**, y se corrige actualizando la dependencia transitiva o resolviendo con un override justificado en `package.json`, nunca silenciando el chequeo. |

## La puerta de seguridad, en detalle

Porque es la única regla de esta área con un paso de pipeline propio, y porque
"luego lo arreglo" es como se cuela una vulnerabilidad durante años. **Hoy está
cerrada** (high = 0); esta sección explica cómo se resolvió y qué queda:

```bash
# Debe salir con código 0 (hoy: 0, sin vulnerabilidades). Es el paso `Security audit` de CI
npm audit --audit-level=high

# El árbol también está limpio en moderate (Nest 12)
npm audit --audit-level=moderate

# Diagnóstico: qué paquete arrastra la vulnerabilidad
npm audit --json | head -50
```

Las tres salidas posibles y qué significan:

| Salida | Significado | Acción |
|---|---|---|
| código 0 | Sin vulnerabilidades high/critical | Requisito cumplido; el paso está en el pipeline |
| código 1 con vulnerabilidades | Deuda real, **bloquea** | Actualizar la transitiva o fijar la versión parcheada con `overrides` en el `package.json` raíz |
| paso ausente en CI | Puerta inexistente | Incumplimiento tanto o más grave que el rojo: hay que añadir el paso |

Cuando la vulnerabilidad llega por una dependencia transitiva (el caso real aquí:
`multer` bajo `@nestjs/platform-express`, `js-yaml`/`lodash` bajo `@nestjs/swagger`,
`deepmerge-ts` bajo `prisma`), el antídoto es un **`overrides` en el `package.json`
raíz** con la versión parcheada, dentro de su mismo rango mayor siempre que se pueda,
más una línea en `AUDIT.md` explicando por qué y una en `decisiones.md` (ADR-16).
Lo que **no** es aceptable es bajar el `--audit-level`, añadir `--audit-level=none`,
o poner `continue-on-error: true` en el paso: en los tres casos la puerta sigue
cerrada y aparenta estar abierta.

> El `overrides` es deuda viva: hay que revisarlo cuando las dependencias que
> arrastran la transitiva se actualicen, y quitarlo en cuanto la versión sana llegue
> por su cuenta. Un `overrides` olvidado es una versión congelada sin dueño.

## Verificación

```bash
# Suite unitaria completa, sin red y sin Docker (R-QA-2)
MONGODB_MOCK=1 npm test

# El árbol está limpio en high y moderate (hoy 0 vulnerabilidades)
npm audit --audit-level=high && echo "R-QA-6 cumplida"
npm audit --audit-level=moderate

# La red real solo en estas capas (R-QA-3)
grep -n '"test:e2e"\|"dev:e2e"\|"test:api"' package.json

# Serialidad comprada a cambio de aislamiento (R-QA-5)
grep -n "fileParallelism" vitest.config.mjs
```
