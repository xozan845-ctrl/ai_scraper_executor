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

- **Reglas:** [`docs/rules/architecture/03-arquitectura-hexagonal.md`](../docs/rules/architecture/03-arquitectura-hexagonal.md)
  (`R-HX-1..9`), en especial `R-HX-2` (dirección de dependencia) y `R-HX-9` (strangler).
- **Plan y mapeo `packages/` → `libs/`:** [`docs/migracion-arquitectura.md`](../docs/migracion-arquitectura.md).
- **Enforcement:** `npm run boundaries:check` (verifica `R-HX-2`; se ejecuta dentro de
  `npm run lint`).

> **Estado (F0):** esta carpeta está **vacía** a propósito. La migración es strangler
> (ADR-30): el código sigue en `packages/` y se moverá paquete a paquete, dejando
> `build` + `lint` + `test` en verde en cada PR. Un paquete no migrado conserva su ruta
> `packages/<x>` y su nombre `@ai-scraper/<x>` (`R-HX-9`).
