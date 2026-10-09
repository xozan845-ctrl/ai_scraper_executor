# @ai-scraper/shared-core

Utilidades **puras y transversales** del monorepo: sin lógica de negocio y sin
dependencias de otras capas (`R-HX-1`, `R-HX-2`).

- **Capa**: `libs/shared/core`.
- **Dependencias**: ninguna (solo `typescript` en desarrollo).
- **Superficie pública**:
  - `hashHtml(html)` — hash estable y barato del HTML (no criptográfico) para detectar deriva de un sitio — `R-SC-15`.

## Comandos

```bash
npm run build -w @ai-scraper/shared-core
node --test tests/util-unify.test.mjs
```
