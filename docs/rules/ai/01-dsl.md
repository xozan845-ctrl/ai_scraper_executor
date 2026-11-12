# 01 — El DSL: qué puede emitir la IA y cómo se valida

Aplica a: [`../../../libs/domain/ai/`](../../../libs/domain/ai) (`schemas.ts`,
`validator.ts`, `normalize.ts`, `limits.ts`) y a todo punto donde una respuesta del
modelo se convierte en acciones.

## Principio

> **La IA propone, el código dispone.** Todo lo que el modelo emite se valida contra
> un esquema cerrado antes de hacer nada. Un comando que no existe no se "interpreta":
> se descarta. Un comando que viola dominio, SSRF o presupuestos hace fallar el plan.

## Reglas

| ID | Regla |
|---|---|
| R-AI-1 | **El DSL es cerrado y es la única superficie de acción**: la IA decide **qué** hacer únicamente mediante los **19 comandos** del enum Zod de [`schemas.ts`](../../../libs/domain/ai/src/value-objects/schemas.ts) (`NAVIGATE`, `EXTRACT`, `EXTRACT_LIST`, `EXTRACT_TABLE`, `EXTRACT_TEXT`, `EXTRACT_STRUCTURED`, `EXTRACT_NETWORK`, `FOLLOW_LINKS`, `PAGINATE`, `SCROLL`, `CLICK`, `TYPE`, `WAIT`, `FINISH`, `AUTHENTICATE`, `GET_ATTRIBUTE`, `INSPECT_PAGE`, `INSPECT_LINKS`, `INSPECT_ELEMENTS`). El motor decide **cómo** ejecutarlos. **Prohibido** que la salida del modelo produzca directamente una llamada `fetch`, una expresión de JavaScript, un comando de shell o una consulta a base de datos. |
| R-AI-2 | **Un comando nuevo nace con su schema y su test**: añadir un `type` al DSL obliga, en el mismo cambio, a (a) su schema Zod, (b) su tratamiento en `normalize.ts` si los modelos débiles se desvían, (c) su ejecución en `libs/infrastructure/execution`, y (d) al menos un test en `tests/dsl.test.mjs` o `tests/engine.test.mjs`. Un `type` sin schema es un tipo que no existe. |
| R-AI-3 | **Validación estricta después de normalizar**: el orden es **siempre** normalizar → validar. `CommandValidator` (`validator.ts`) aplica el schema Zod y **rechaza** el plan entero si un comando viola el esquema, el dominio, la allowlist o los presupuestos. La normalización **no** relaja la validación: solo corrige desviaciones conocidas de formato (`{"action":"navigate"}` → `{"type":"NAVIGATE"}`, `maxItems` → `limit`, `cssSelector` → `selector`, `pages` → `maxPages`, `{steps:[…]}` → `actions`). |
| R-AI-4 | **Normalizador antes que validado, y el normalizador es una lista cerrada**: `normalize.ts` corrige únicamente las formas que se han observado en modelos reales y las documenta en su tabla. Un comando **inventado** por el modelo (p. ej. `loop`, `waitForSelector`, `runScript`) **se descarta**, no se "adapta". Cualquier corrección nueva del normalizador llega con un test que reproduce la salida desviada del modelo. |
| R-AI-5 | **Ningún comando ejecutable sin validación SSRF**: toda URL que aparezca en un comando (`NAVIGATE`, `EXTRACT`, `EXTRACT_LIST`, `FOLLOW_LINKS`, `PAGINATE`, `CLICK`, `AUTHENTICATE`…) pasa por `@ai-scraper/shared-security` (`assertPublicUrl` / `assertSafeUrl`) **en el momento de validarse el comando**, no solo en la creación del job. Es la defensa que impide que el modelo redirija el crawler a un host interno → `R-SE-1`. |
| R-AI-6 | **La allowlist se fija al crear el job y la IA no la escala**: el dominio del job se fija cuando se crea (derivado de la URL del job y de `ALLOWED_DOMAINS`). Un comando que apunte a otro dominio hace **fallar el plan**; no se "amplía la lista". No hay ningún comando del DSL capaz de cambiar el host permitido. |
| R-AI-7 | **Los presupuestos se recortan en dos puntos, y el motor es el segundo**: el recorte de `maxPages` / `maxItems` / `maxLinks` se aplica (a) al plan generado por el planner y (b) **a cada decisión dinámica** posterior (análisis de página en el bucle Observe→Think→Act y recovery), mediante `clampCommandLimits` en [`../../../libs/domain/ai/src/limits.ts`](../../../libs/domain/ai/src/limits.ts). La IA nunca puede elevar un límite del job (`R-SC-2`). |
| R-AI-8 | **El prompt declara el esquema, no el modelo lo adivina**: los prompts del planner, del explorador y del recovery ([`../../../libs/infrastructure/ai-providers/src/prompts.ts`](../../../libs/infrastructure/ai-providers/src/prompts.ts)) incluyen el esquema DSL completo **y** un ejemplo, exigen el campo `type` en mayúsculas y prohíben explícitamente comandos inventados. Un prompt nuevo o modificado que olvide el esquema es un bug de prompting, no un problema del modelo. |

## Verificación

```bash
# El enum Zod del DSL: debe listar los 19 comandos
grep -oE "z.literal\('[A-Z_]+'\)" libs/domain/ai/src/value-objects/schemas.ts | sort -u

# El recorte de límites existe y se aplica en el motor
grep -rn "clampCommandLimits" packages apps --include=*.ts

# Ninguna URL de comando se salta el módulo de seguridad
grep -rn "assertPublicUrl\|assertSafeUrl" libs/domain/ai apps/worker --include=*.ts
```
