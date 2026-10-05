# 02 — Proveedor, modelos, prompts y presupuesto

Aplica a: [`../../../packages/ai-providers/`](../../../packages/ai-providers)
(`openrouter.provider.ts`, `custom.provider.ts`, `fallback.provider.ts`,
`circuit-breaker.ts`, `resilient.ts`, `provider.factory.ts`, `prompts.ts`) y a
[`../../../packages/ai/`](../../../packages/ai) (`ai-orchestrator.ts`, `context-builder.ts`).

## Reglas

| ID | Regla |
|---|---|
| R-AI-9 | **Un proveedor por detrás de la interfaz, elegido por variable**: el sistema habla con el LLM a través de `AIProvider` y el proveedor concreto lo decide `provider.factory.ts` a partir de `AI_PROVIDER` (`openrouter` por defecto, `custom` para Ollama/vLLM). Ningún `import` del SDK de OpenRouter fuera de `packages/ai-providers` (→ `R-AR-7`). Añadir un proveedor es añadir un archivo `*.provider.ts` y una rama en la factory, no editar el orquestador. |
| R-AI-10 | **El modelo principal y sus alternativas son configuración, no código**: `OPENROUTER_MODEL` es el principal y `OPENROUTER_FALLBACK_MODELS` la lista ordenada de alternativas. Prohibido hardcodear un ID de modelo en el código o en un test de producción. El valor por defecto debe ser `openrouter/free` (o el router que auto-elige) para que el proyecto arranque sin pagar; el camino de pago se activa por variable. |
| R-AI-11 | **El fallback salta solo ante 404 y 429**: ante `404` (el modelo no existe / no está disponible para la cuenta) y ante `429` (rate limit del proveedor) se pasa al siguiente modelo de `OPENROUTER_FALLBACK_MODELS`. **Cualquier otro** error (401, 402, 403, 5xx) se propaga y **no** cambia de modelo. Regla derivada de los códigos reales de la API: saltar de modelo ante un `403` (sin créditos) esconde la causa real y gasta la lista de alternativas. |
| R-AI-12 | **Un job tiene presupuesto de tokens y lo agota**: el límite `maxAiTokens` (por defecto en `DEFAULT_LIMITS`, con tope en `HARD_LIMITS`) se descuenta con el consumo real de cada llamada; al superarlo el job **se corta** con un estado terminal y un `JobError` explicativo, en lugar de seguir consumiendo coste. `0` o un valor no numérico **no** desactiva el presupuesto: normaliza al del servidor (`normalizeJobLimits`) → `R-DI-4`. |
| R-AI-13 | **La caché de respuestas LLM tiene TTL y no es la verdad**: la caché de respuestas del LLM (Redis, con respaldo en memoria) existe para no repetir una llamada idéntica. Su TTL es corto y explícito, y ante un fallo de caché el sistema **sigue funcionando** con una llamada nueva. Un acierto de caché **nunca** se persiste como resultado definitivo de negocio sin pasar por la fase de ejecución → `R-DI-5`, `R-RD-3`. |
| R-AI-14 | **El circuit breaker aísla un proveedor caído**: cuando un proveedor encadena fallos por encima de un umbral, el breaker se abre y las llamadas siguientes fallan rápido (sin esperar el timeout) hasta que expire la ventana de recuperación. El breaker envuelve al proveedor, no al job: un provider caído degrada la fase de IA, no impide persistir ni cerrar el job. Verificar que un job termina en estado terminal (no colgado) cuando el proveedor no responde. |
| R-AI-15 | **Los prompts son código y se versionan**: `prompts.ts` es la fuente del texto que se envía al modelo. Modificar un prompt es un cambio de comportamiento: exige revisar los tests que asertan sobre el plan/parseo y, si cambia el esquema esperado, actualizar el prompt **y** su ejemplo a la vez (`R-AI-8`). Prohibido construir el prompt con concatenación de strings no trazable: se compone con los valores del contexto que inyecta `context-builder.ts` (perfil aprendido, página actual, límites del job) y ese contexto es visible en la traza del job. |
| R-AI-16 | **El perfil aprendido es una pista, no una orden**: el `SiteProfile` aprendido de la radiografía (selectores, `needsBrowser`) se inyecta en el contexto del planner como **sugerencia**. Si el plan resultante no valida, se descarta el perfil y se vuelve a planificar; un selector aprendido nunca se ejecuta sin pasar el mismo `CommandValidator` que un selector recién generado → `R-AI-3`, `R-AI-5`. |

## Verificación

```bash
# El proveedor se elige por variable y el fallback solo salta en 404/429
grep -rn "OPENROUTER_FALLBACK_MODELS\|status === 404\|status === 429" packages/ai-providers/src

# El presupuesto de tokens se aplica antes de la llamada
grep -rn "maxAiTokens" packages apps --include=*.ts | head

# Ningún SDK de OpenRouter fuera de packages/ai-providers
grep -rln "openrouter" packages/ai/src apps --include=*.ts
```
