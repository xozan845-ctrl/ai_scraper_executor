# scripts/ — Casos de uso para probar la API (PowerShell)

Scripts `.ps1` que recorren **todos los flujos** de la API para verificar que un
frontend tipo chat puede funcionar. No implementan UI: solo ejercitan los endpoints.

## Requisitos

- **PowerShell 7+ (`pwsh`)**. En Linux/macOS: `https://learn.microsoft.com/powershell/scripting/install/installing-powershell`
- La API corriendo (`npm run dev:api` o `docker compose up -d api`), con Postgres/Mongo/Redis arriba.
- Para flujos con IA/radiografía: `OPENROUTER_API_KEY` en `.env` (si no, el job/radiografía puede fallar).

## Configuración (variables de entorno)

| Variable | Default | Descripción |
|---|---|---|
| `API_URL` | `http://localhost:3000/api/v1` | Base URL de la API |
| `API_KEY` | *(vacío)* | Valor para el header `x-api-key` (si el server tiene `API_KEYS`) |
| `TEST_URL` | `https://www.sevasaonline.com/` | URL a analizar en los flujos |

```bash
export API_URL=http://localhost:3000/api/v1
export API_KEY=mi-clave            # opcional
export TEST_URL=https://www.sevasaonline.com/
```

## Scripts

| Script | Flujo |
|---|---|
| `00-health.ps1` | Liveness/readiness y disponibilidad de OpenAPI (`/docs-json`). |
| `01-session-flow.ps1` | **Flujo principal del chat**: crear sesión → poll `status` hasta `READY` (input bloqueado) → enviar instrucción → poll job → resultados → historial. |
| `02-sessions-history.ps1` | Historial de sesiones: listar, crear, verificar que aparece y detalle sin credenciales. |
| `03-credentials.ps1` | Sesión con `credentials.headers` (Authorization/Cookie); verifica que **nunca** se devuelven. |
| `04-jobs.ps1` | Jobs: crear, listar (cursor + filtro `status`), execution, ai, **idempotencia** (`Idempotency-Key`), cancel, retry 404. |
| `05-radiography.ps1` | Radiografía directa + perfil/selectores/stats del dominio. |
| `06-errors.ps1` | SSRF/validación, 404s, enviar mensaje antes de `READY` (409) y auth 401. |
| `run-all.ps1` | Ejecuta todo y resume PASS/FAIL. `-SkipSlow` omite los flujos con radiografía/job real. |

## Uso

```bash
# Todo (incluye flujos lentos con radiografía/LLM)
pwsh ./scripts/run-all.ps1

# Solo lo rápido (sin radiografía/job real)
pwsh ./scripts/run-all.ps1 -SkipSlow

# Un flujo concreto
pwsh ./scripts/01-session-flow.ps1 -BaseUrl http://localhost:3000/api/v1 -ApiKey mi-clave -Url https://example.com/
```

Cada script lanza excepciones en caso de fallo y `run-all.ps1` termina con código
de salida `1` si algo falla (útil para CI).

## Notas

- `03-credentials.ps1` avisa (no falla) si el servidor no tiene `CREDENTIALS_KEY`:
  en ese caso la API rechaza guardar credenciales con un 400.
- Los flujos `01` y `05` hacen scraping real y pueden tardar ~1 min.
- `lib.ps1` contiene los helpers (`Invoke-Api`, `Wait-SessionReady`, `Wait-JobDone`, `Assert-Fails`).
