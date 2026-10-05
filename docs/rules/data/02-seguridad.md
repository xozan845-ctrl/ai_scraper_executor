# 02 — Reglas Doradas de Seguridad de Datos

Aplica a: secretos, credenciales, contraseñas, API keys, PII y dependencias en todo
el repo.

## Reglas

| ID | Regla |
|---|---|
| R-DS-1 | **Ningún secreto en el repositorio**: claves de API (`OPENROUTER_API_KEY`, `API_KEYS`, `CREDENTIALS_KEY`, `DATABASE_URL`, `MONGODB_URI`, `REDIS_URL`) vienen **siempre** del entorno. `.env` está en `.gitignore` **y** en `.dockerignore`; lo versionado es `.env.example` con valores de desarrollo y una plantilla de producción con marcadores. Ninguna credencial se escribe a mano en un `docker-compose.yml`, un test o un Dockerfile. Si un secreto se versionó, se reescribe la historia: no se "corrige después" (`R-SE-17`, `R-GA-4`). |
| R-DS-2 | **Contraseñas y claves de usuario se hashean, nunca se cifran ni se guardan en claro**: las contraseñas del usuario se almacenan con **bcrypt** (hashe salado); las API keys de usuario se guardan hasheadas (SHA-256) y la verificación es una comparación de hash, no una lectura del valor original (`R-SE-10`). Ninguna contraseña ni API key de usuario se devuelve por ningún endpoint. |
| R-DS-3 | **Las credenciales del sitio objetivo son el dato más sensible que maneja el sistema, y se cifran y no salen**: las cabeceras de autenticación de una sesión se cifran en reposo con **AES-256-GCM** (`CREDENTIALS_KEY`) y se descifran solo en el worker para aplicarlas a la petición y al navegador (`R-SE-11`, `R-SE-13`). La API **nunca** las devuelve (ni en claro ni cifradas), nunca las registra en logs y nunca las incluye en una métrica. Un `GET /api/v1/sessions/:id` muestra que hay credenciales, no cuáles son. |
| R-DS-4 | **Validación estricta de entradas en el borde (OWASP)**: cada payload de la API está respaldado por un DTO con `class-validator` y se limpia con `ValidationPipe({ whitelist: true, transform: true })` global en `apps/api/src/main.ts`. Esto corta el *mass assignment*: un cliente no puede inyectar campos extra (p. ej. `status: 'COMPLETED'`, `userId`, `sessionId` ajeno) porque se descartan. Un endpoint nuevo sin DTO, o un DTO sin validación de sus campos, es un fallo de esta regla. |
| R-DS-5 | **Mínimo privilegio: lo que no se necesita, no se pide ni se devuelve**: cada endpoint expone lo mínimo para su propósito y los listados **paginan** (límite por defecto y máximo acotado). Prohíben los listados completos sin paginación sobre tablas que crecen con cada job. El `SELECT` de un DTO nombra las columnas que devuelve: nunca se serializa una entidad/fila cruda de persistencia (que incluiría `credentials` o campos internos) → `R-SE-11`. |
| R-DS-6 | **Nada de PII ni secretos en logs**: los logs son JSON estructurado (`R-OB-5`); no se escriben contraseñas, tokens, cabeceras de autorización, cookies ni API keys, ni datos personales de terceros. Cuando un log necesite un identificador de job/sesión, usa el identificador opaco, no el contenido. Esta regla hereda de `R-DS-3`: un log es un sitio público desde donde no se puede borrar nada. |
| R-DS-7 | **Dependencias saneadas y auditadas en CI**: `npm audit --audit-level=high` es un paso obligatorio del pipeline que falla el build ante vulnerabilidades high/críticas (`R-SE-16`, `R-QA-6`). Hoy **sale en 0 y está configurado** en el job `build-test-lint` (paso `Security audit`); las transitivas se parchearon con `overrides` (ADR-16) y queda **1 moderate** de `@nestjs/core` como deuda declarada en [`../_meta/AUDIT.md`](../_meta/AUDIT.md). No se sube el umbral ni se añade `--force` para silenciar el paso; se actualiza la dependencia o se fija la versión parcheada. |

## Verificación

```bash
# .env nunca versionado
grep -n "env" .gitignore .dockerignore

# Contraseñas hasheadas, API keys hasheadas (no en claro)
grep -rn "bcrypt\|createHash" apps/api/src --include=*.ts | head

# El whitelist de validación está activo globalmente
grep -n "ValidationPipe" apps/api/src/main.ts

# Ningún log imprime credenciales (búsqueda de cosas que no deben estar)
grep -rniE "log.*(authorization|cookie|apikey|api_key|password)" apps packages --include=*.ts | head
```
