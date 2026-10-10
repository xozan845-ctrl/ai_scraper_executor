# libs/ — Librerías internas (arquitectura hexagonal)

Destino de la **arquitectura hexagonal** (ADR-27): aquí viven las capas internas del
monorepo. Las apps (`apps/api`, `apps/worker`) son el **composition root** y consumen
estas libs; ninguna lib importa de `apps/*`.

```
libs/
├── domain/<contexto>/          entidades, value objects, servicios puros y PUERTOS
├── application/<contexto>/     casos de uso y DTOs (coordinan puertos)
├── infrastructure/<adaptador>/ adaptadores concretos (Prisma, Mongo, Redis, BullMQ, Crawlee, OpenRouter)
└── shared/<utilidad>/          transversal pura (core, observability, config, contracts)
```

Contextos del dominio: `scraper`, `ai`, `execution`. Nombre de paquete:
`@ai-scraper/<capa>-<contexto>` (p. ej. `@ai-scraper/domain-scraper`).

`application/execution` es propietario de `JobStore`, `SessionStore` y `JobQueue`;
`infrastructure/storage` e `infrastructure/queue` contienen únicamente sus adaptadores.

- **Reglas:** [`docs/rules/architecture/03-arquitectura-hexagonal.md`](../docs/rules/architecture/03-arquitectura-hexagonal.md)
  (`R-HX-1..14`), en especial `R-HX-2` (dirección), `R-HX-10..12` (apps, puertos y adaptadores) y `R-HX-14` (cierre).
- **Plan y mapeo `packages/` → `libs/`:** [`docs/migracion-arquitectura.md`](../docs/migracion-arquitectura.md).
- **Enforcement:** `npm run boundaries:check` (verifica `R-HX-2`; se ejecuta dentro de
  `npm run lint`).

> **Estado:** traslado físico F0–F5 completado (`packages/` retirado y Vitest activo);
> F7 está en curso: los contratos de jobs/sesiones/cola ya se extrajeron, pero quedan
> otros puertos y la conformidad F8–F10 (ADR-33). La ubicación correcta no demuestra
> por sí sola que los casos de uso y puertos estén en su capa.
