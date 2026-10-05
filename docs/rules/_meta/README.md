# _meta/ — Documentos derivados (NO son reglas)

Carpetas marcadas con `_` = **no normativa**. Nada de aquí obliga: todo se deriva
de las reglas de las áreas ([`architecture/`](../architecture/README.md),
[`ai/`](../ai/README.md), [`security/`](../security/README.md),
[`scraping/`](../scraping/README.md), [`data/`](../data/README.md),
[`db/`](../db/README.md), [`observability/`](../observability/README.md),
[`test/`](../test/README.md), [`git/`](../git/README.md), [`ci/`](../ci/README.md),
[`cd/`](../cd/README.md)) y se actualiza cuando éstas cambian.

| Archivo | Qué es | Cuándo se actualiza |
|---|---|---|
| [`CHECKLIST.md`](./CHECKLIST.md) | Herramienta de revisión de PR derivada de las reglas (cada ítem remite a su ID) | Cuando cambian reglas que afecten a la revisión de un PR |
| [`AUDIT.md`](./AUDIT.md) | **Snapshot** del estado actual de cumplimiento — se reescribe completo | En cada auditoría, antes de cada release (`R-COV-3`) |
| [`AUDIT-HISTORY.md`](./AUDIT-HISTORY.md) | Log **append-only** de auditorías | Nunca se reescribe: solo se agrega la entrada nueva |

## Reglas de estructura

1. Los documentos de esta carpeta **jamás** contienen reglas propias: solo resumen,
   estado o historial de las reglas que viven en las áreas. Si hace falta una regla
   nueva, se escribe en su área.
2. Si un archivo derivado y su regla de origen discrepan, **manda la regla** (y se
   corrige el derivado).
3. Prohibido mover un audit/checklist dentro de un área: un área es 100 % reglas
   (`README.md` + archivos `NN-tema.md`).
4. Las cifras de `AUDIT.md` son **medidas**, con el comando con el que se midieron a
   la vista. Heredar cifras de otro proyecto es el error que motivó reescribir este
   árbol por completo.

## Procedencia

Esta carpeta y todo `docs/rules/` llegaron copiado de un proyecto distinto
(«Core Engine», un e-commerce con microservicios, Supabase, RabbitMQ, CQRS y
Angular). Ese árbol **no describe este repo**. La reescritura completa del
2026-10-05 sustituyó contenido, refs y cifras; lo que se conserva de la
metodología es el *método* (IDs estables, reglas verificables, snapshot +
histórico), no el contenido.

Las entradas heredadas del proyecto de origen permanecen en
[`AUDIT-HISTORY.md`](./AUDIT-HISTORY.md) marcadas como tales: son procedencia, no
estado. Cualquier lectura del estado actual es [`AUDIT.md`](./AUDIT.md).
