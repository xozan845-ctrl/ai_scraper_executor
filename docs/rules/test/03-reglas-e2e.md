# 03 — Reglas de Tests E2E (pila completa: API + cola + worker + sitio real + LLM real)

Aplica a: pruebas que recorren la pila completa contra un **sitio real** y un
**proveedor de LLM real**: [`../../../tests/e2e-sevasa.test.mjs`](../../../tests/e2e-sevasa.test.mjs)
(`npm run test:e2e`) y, en su versión más amplia, el cliente real de la API en
[`../../../scripts/`](../../../scripts) (`npm run test:api`).

> El E2E de este repo **no prueba una UI** (no hay frontend): prueba el flujo
> completo de backend —se crea un job/sesión, el worker lo consume, el LLM planifica,
> el crawler extrae de una web real, se persiste y se devuelve con su trazabilidad—. Es
> la única capa que demuestra que las piezas encajan con un modelo y un sitio de verdad.

## Flujos críticos (obligatorios antes de cada release)

| ID | Regla | Flujo |
|---|---|---|
| R-E-1 | **Job de principio a fin**: se crea un job para una URL real, se espera a que el worker lo procese y termina en estado terminal, y se comprueba que hay resultados con `_source` y que `GET /api/v1/jobs/:id/results` los devuelve. | ciclo del job |
| R-E-2 | **Fallo controlado de autenticación**: sin `x-api-key` (o con clave inválida) la ruta protegida devuelve `401` y no se crea ningún job. | authz |
| R-E-3 | **Ciclo de sesión "chat"**: `POST /api/v1/sessions` → la radiografía se lanza → `GET /api/v1/sessions/:id/status` pasa por `RADIOGRAPHY` a `READY` → un mensaje crea un job → el historial incluye el resultado del mensaje. Es el flujo que consume un cliente web y el que más se rompe entre versiones. | sesión |
| R-E-4 | **Credenciales de una web con login**: al crear una sesión con `credentials.headers`, esas cabeceras se aplican a la petición y al navegador, y **no** aparecen devueltas por ningún endpoint, ni en claro ni cifradas. | credenciales |
| R-E-5 | **Trazabilidad verificable en la salida**: al menos un item devuelto trae `_source` con una `url` real (la que se raspó), un `selector` y un `scrapedAt` ISO. Se comprueba que la `url` de `_source` es del dominio permitido del job. | trazabilidad |
| R-E-6 | **Límites respetados**: un job con `limits` bajos termina y sus resultados no superan `maxItems`/`maxPages` del job, aunque el LLM pidiera más. Es la prueba de que el recorte del motor funciona (`R-SC-2`). | presupuestos |
| R-E-7 | **Cancelación y limpieza**: cancelar un job en curso lo lleva a `CANCELLED` (no lo deja colgado) y relanzarlo no duplica resultados previos (`clearJobArtifacts`, `R-SC-13`). | cancelación |
| R-E-8 | **Cero errores no controlados en los logs** de la API y del worker durante el flujo. Un error inesperado en el log es un fallo del test aunque el flujo haya "terminado bien". | calidad |

## Calidad de ejecución

| ID | Regla |
|---|---|
| R-E-9 | **El E2E verifica por datos**, no por tiempos: el estado del job, el contenido de los resultados, la `url` de `_source`, los conteos. Un E2E que solo espera "no falló" no comprueba el requisito. |
| R-E-10 | **Sin datos del modelo asumidos.** El LLM real puede cambiar de plan o de wording entre ejecuciones; el test comprueba invariantes (el job termina, hay resultados trazables, se respetan los límites), **nunca** un texto exacto del plan ni un número de resultados fijo. Un E2E acoplado a una frase del modelo falla sin que nada esté roto. |
| R-E-11 | **Hermético respecto al estado del repo, no del sitio de terceros**: el E2E sí depende de un sitio externo real (es su propósito) y por eso necesita red; pero no depende de datos previos de nuestra base: cada ejecución crea su propio job/sesión y no asume nada de una ejecución anterior. La URL objetivo viene de variable (`TEST_URL`), no hardcodeada en el test, para poder apuntarlo a otro sitio. |
| R-E-12 | **Timeout explícito por paso y un solo reintento.** El E2E real es lento y depende de la red: cada espera tiene su propio límite (esperar un job, no esperar "lo que sea"), y el script se deja un reintento **único** para un fallo de red, no más. Un timeout global enorme esconde un cuelgue; un E2E que reintenta tres veces esconde una regresión. |
| R-E-13 | **Los scripts E2E viven en el repo**, con su comando en `package.json` y sus variables documentadas (`scripts/README.md`). Nada de pruebas en `/tmp` ni de pasos manuales que solo una persona sabe hacer. |

## Mínimo aceptable por release

- El E2E de `npm run test:e2e` en verde con un modelo real (aunque sea `:free`), y el
  cliente de `npm run test:api` recorriendo los flujos de `/api/v1/sessions`,
  `/api/v1/jobs`, `/api/v1/radiography` y errores sin fallos inesperados.
- Requiere: Docker (Postgres + Mongo + Redis), `OPENROUTER_API_KEY` en el entorno, y
  Playwright Chromium instalado en el host (`npx playwright install --with-deps chromium`
  para E2E fuera de Docker).
- Si un flujo crítico no puede automatizarse, queda registrado en
  [`../_meta/AUDIT.md`](../_meta/AUDIT.md) como deuda con responsable y fecha.

## Verificación

```bash
# Levantar BDs, migrar, compilar y ejecutar el E2E real
npm run dev:e2e

# Solo el E2E (carga .env con node --env-file)
OPENROUTER_API_KEY=... npm run test:e2e

# El cliente real de la API contra un sitio real
TEST_URL=https://tu-sitio.example npm run test:api
```
