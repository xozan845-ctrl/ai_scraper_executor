# scripts/ — Cliente real para probar toda la infraestructura

Cliente de API en **Node.js** (universal: macOS, Windows y Linux) que recorre **todos los flujos**
para verificar que un frontend tipo chat puede funcionar. No implementa UI: ejercita los endpoints reales.

Usa el `fetch` nativo de Node ≥20 — **sin dependencias**.

## Requisitos

- **Node ≥20** (ya es requisito del proyecto).
- La API corriendo (`npm run dev:api`, o `docker compose up -d api`), con Postgres/Mongo/Redis arriba.
- Para flujos con IA/radiografía: `OPENROUTER_API_KEY` en `.env` (si no, el job/radiografía puede fallar).

## Configuración (variables de entorno)

| Variable | Default | Descripción |
|---|---|---|
| `API_URL` | `http://localhost:3000/api/v1` | Base URL de la API |
| `API_KEY` | *(vacío)* | Valor para el header `x-api-key` (si el server tiene `API_KEYS`) |
| `TEST_URL` | `https://www.sevasaonline.com/` | URL a analizar en los flujos |
| `TEST_HEADERS_JSON` | *(vacío)* | Headers reales de sesión, por ejemplo `{"Authorization":"Bearer ..."}` |
| `TEST_PROMPTS_JSON` | un prompt de productos | Array JSON de prompts para continuar el mismo chat |
| `TEST_CREDENTIAL_PROMPT` | datos disponibles | Prompt usado por el flujo autenticado |
| `TEST_REQUIRE_ITEMS` | `1` | Si es `0`, permite jobs completados sin items |

```bash
# macOS / Linux
export API_URL=http://localhost:3000/api/v1
export API_KEY=mi-clave            # opcional
export TEST_URL=https://www.sevasaonline.com/
export TEST_HEADERS_JSON='{"Authorization":"Bearer token-real"}' # opcional
export TEST_PROMPTS_JSON='["Obtén productos","Obtén también las categorías"]'
node scripts/run-all.mjs

# Windows PowerShell
$env:API_URL = "http://localhost:3000/api/v1"
$env:API_KEY = "mi-clave"
$env:TEST_HEADERS_JSON = '{"Authorization":"Bearer token-real"}'
$env:TEST_PROMPTS_JSON = '["Obtén productos","Obtén también las categorías"]'
node scripts\run-all.mjs
```

## Uso

```bash
npm run test:api             # todos los escenarios (incluye scraping/LLM real)
npm run test:api:fast        # solo los rápidos (sin radiografía/job real)

# equivalente
node scripts/run-all.mjs
node scripts/run-all.mjs --skip-slow
```

`run-all.mjs` termina con código de salida `1` si algo falla (útil para CI).

## Escenarios

| Archivo | Flujo |
|---|---|
| `flows/00-health.mjs` | Liveness/readiness y OpenAPI (`/docs-json`). |
| `flows/01-session-chat.mjs` | **Flujo completo del chat**: crear URL + headers opcionales → poll `status` hasta `READY` (input bloqueado) → uno o varios prompts → poll de cada job → resultados → historial. |
| `flows/02-sessions-history.mjs` | Historial de sesiones: listar, crear, verificar aparición, detalle sin credenciales. |
| `flows/03-credentials.mjs` | Flujo autenticado real: headers → radiografía autenticada → prompt después de `READY` → job/resultados; nunca expone credenciales. |
| `flows/04-jobs.mjs` | Jobs: crear, listar (cursor + filtro), execution, ai, **idempotencia**, cancel, retry 404. |
| `flows/05-radiography.mjs` | Radiografía directa + perfil/selectores/stats del dominio. |
| `flows/06-errors.mjs` | SSRF/validación, 404s, mensaje antes de `READY` (409), auth 401. |

## Estructura

```
scripts/
  client.mjs        # cliente de la API (todos los endpoints)
  harness.mjs       # helpers: t.step/ok/assert/expectFail + waitFor
  run-all.mjs       # ejecuta todos los escenarios y resume
  flows/*.mjs       # un archivo por flujo
  README.md
```

## Añadir un escenario

Crea `flows/07-mio.mjs` exportando `{ name, slow, run(client, t) }` y añádelo al array en `run-all.mjs`.

```js
export default {
  name: '07-mio',
  slow: false,
  async run(c, t) {
    t.step('Mi flujo');
    const r = await c.listJobs('?limit=1');
    t.ok(`items=${r.items.length}`);
  },
};
```

## Notas

- `03-credentials.mjs` se omite si no existe `TEST_HEADERS_JSON`; con headers configurados prueba todo el flujo
  y exige `CREDENTIALS_KEY` en el servidor.
- Los escenarios `01`, `03` y `05` hacen scraping real y pueden tardar varios minutos.
- `01` falla si el job termina `FAILED` o si no devuelve items (usa `TEST_REQUIRE_ITEMS=0` solo para sitios sin listados).
- Nunca pongas tokens reales directamente en un script; pásalos por variables de entorno y rota cualquier token expuesto.
