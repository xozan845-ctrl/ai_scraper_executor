# 01 — Reglas Doradas de Logs y correlación

Aplica a: [`../../../libs/shared/observability/src/logger.ts`](../../../libs/shared/observability/src/logger.ts)
y a todo punto del repo que registre algo.

## Reglas

| ID | Regla |
|---|---|
| R-OB-1 | **Todo log es una línea JSON, no un texto suelto**: el logger emite un único objeto JSON por evento con `ts`, `level`, `msg`, `instance` y los campos del contexto y del evento (`jobId`, `provider`, `durationMs`, …). No se escribe con `console.log` una estructura complexa que haya que parsear después. Los `console.error` sueltos están permitidos **solo** para el arranque y el apagado del proceso (antes/después de que exista el logger con contexto). |
| R-OB-2 | **Toda petición y todo job llevan `correlationId`, y se propaga por el contexto**: la API acepta un `x-correlation-id` entrante o genera uno, lo pone en la respuesta y lo propaga por `AsyncLocalStorage` (`runWithContext`). El worker lo recoge de la cola y lo mantiene durante todo el job, de modo que los logs de la API, de la cola, del planner, del crawler y del LLM se pueden unir por ese identificador. Un log de un job que no lleva `correlationId` es un log huérfano: rompe la premisa de poder seguir un job entero. |
| R-OB-3 | **Nombres de métrica ASCII y con la convención del proyecto**: los contadores y gauges usan el prefijo `scraper_` y solo caracteres ASCII y guiones bajos (`scraper_jobs_created_total`, `scraper_pages_scraped_total`). Prometheus descarta silenciosamente los nombres con caracteres no válidos (`órdenes_creadas_total` no aparece nunca). Convención completa en `R-TM-2`. |
| R-OB-4 | **El nivel dice la urgencia real**: `ERROR` = algo falló y necesita atención (excepción, caída de dependencia, job fallido por causa no recuperable); `WARN` = anómalo pero tolerado (un reintento, un fallback a memoria, un plan inválido que se regenera, un 429 del proveedor); `INFO` = cambios de estado de negocio (job creado, job completado, cola de muertos con un job); `DEBUG` = detalle de desarrollo (spans, cargas de configuración), y `LOG_LEVEL` lo apaga en producción. Subir de nivel un `WARN` habitual (p. ej. cada fallback a memoria) entrena al operador a ignorar warnings. |
| R-OB-5 | **Sin datos sensibles ni PII en los logs**: nunca se registran contraseñas, API keys, tokens, cabeceras `Authorization`/`Cookie`, credenciales de sesión (ni en claro ni cifradas) ni datos personales de terceros. Para seguir un caso se usa el identificador opaco (`jobId`, `sessionId`, `correlationId`), no el contenido. Un log es público desde que existe: no se puede borrar de los agregadores. Ver `R-DS-6`. |
| R-OB-6 | **Los spans se usan para medir, no para rellenar**: `withSpan` mide la duración de un bloque y la emite en `DEBUG` como span con `durationMs`. No se envuelve todo el código en spans (el ruido ahoga la señal) ni se emite un span sin usar su duración para algo (un dashboard, una alerta o una decisión de rendimiento). Un span que nadie mira es un coste de CPU sin retorno. |

## Verificación

```bash
# El logger emite JSON con los campos base
grep -n "ts\|level\|msg\|instance" libs/shared/observability/src/logger.ts | head

# El contexto de correlación se propaga a la cola y al worker
grep -rn "runWithContext\|updateContext" apps packages libs --include=*.ts | head

# Sin secretos en logs
grep -rniE "logger?\.(info|warn|error).*(authorization|cookie|password|apikey)" apps packages libs --include=*.ts
```
