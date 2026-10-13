# scripts/rules/ — Gobernanza arquitectónica SOLID

Suites de **análisis estático** (leen el código TS, no lo ejecutan) que detectan
violaciones reales de SOLID en la arquitectura NestJS. Se ejecutan dentro de
`npm test` y con `npm run test:rules`.

No sustituyen a los gates hexagonales (`scripts/check-boundaries.mjs`, `R-HX-2`);
los complementan: las fronteras dicen *qué capa importa a cuál*, estas suites dicen
*cómo se responsabiliza cada pieza*.

## Suites

| Archivo | Principio | Qué vigila |
|---|---|---|
| `solid-s-layers.test.mjs` | **SRP** | Las libs no importan el framework HTTP (`express`/`@nestjs`); solo los `*.controller.ts` importan tipos de Express; los controllers no acceden a persistencia (infraestructura/Prisma). |
| `solid-o-extensibility.test.mjs` | **OCP** | La decisión de acceso (API key, `X-First-Run`) vive solo en `*.guard.ts`; controllers/servicios no la implementan con condicionales. |
| `solid-l-substitution.test.mjs` | **LSP** | Guards, interceptores, middleware y filtros respetan el contrato Nest: solo lanzan `HttpException`/`*Exception`, nunca `new Error(...)` crudo. |
| `solid-i-segregation.test.mjs` | **ISP** | Ninguna interfaz expuesta es un "god interface" (> 20 miembros) y cada DTO lo consume un único controller. |
| `solid-d-inversion.test.mjs` | **DIP** | `libs/domain` y `libs/application` no leen `process.env` ni importan infraestructura/apps; servicios y controllers inyectan dependencias en vez de instanciarlas con `new`. |

## Uso

```bash
npm run test:rules                     # solo estas suites
npm test                               # toda la suite (incluye estas)
npx vitest run scripts/rules/solid-d-inversion.test.mjs   # una sola
```

## Baseline (ratchet)

`baseline.json` registra la **deuda SOLID aceptada temporalmente**. Las suites solo
fallan con violaciones **nuevas**: cada entrada se justifica y debe eliminarse al
refactorizar. **Hoy está vacío**: las 3 violaciones iniciales se corrigieron con
`RadiographyService`, `MetricsService` y `FirstRunGuard`.

`npm test` imprime por `stderr` cuántas excepciones de baseline se aplicaron.

## Cómo añadir una regla

1. Crea `scripts/rules/solid-<letra>-<tema>.test.mjs` reutilizando `_shared.mjs`
   (`collectSourceFiles`, `stripComments`, `importSpecifiers`, `assertClean`).
2. Cada violación es `{ file, line?, detail }`; `assertClean(rule, violations)` las
   filtra contra el baseline y falla con un mensaje legible.
3. Si nace con violaciones reales, **no** las ocultes sin más: documÉntalas en
   `baseline.json` con motivo y retíralas al corregirlas.
4. Añade el fichero a `npm test` y, si aplica, descríbelo en esta tabla.

## Limitaciones (honestidad sobre heurísticas)

- El análisis es por expresiones regulares sobre el código sin comentarios: puede
  tener falsos negativos (patrones no contemplados). No es un type-checker.
- **DIP**: la regla literal "cero `process.env` fuera de `ConfigService`" aún no se
  cumple porque no existe `ConfigService`; `apps/*` y `libs/{shared,infrastructure}`
  leen env directamente. Esta suite limita el núcleo (`domain`/`application`) y
  bloquea `new` de dependencias en servicios/controllers. Migrar a un
  `ConfigService` es trabajo pendiente.
- **ISP**: el umbral de miembros (20) y la regla de DTO por controller son
  heurísticas; `JobStore` (19 miembros) está cerca del límite.
