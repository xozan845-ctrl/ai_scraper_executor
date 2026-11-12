# @ai-scraper/infrastructure-ai-providers

Los **adaptadores de LLM**: el único sitio donde se habla con el proveedor. El resto
del sistema habla con la interfaz `AIProvider` (`R-AR-7`, `R-AI-9`).

- **Capa**: inteligencia.
- **Dependencias exclusivas**: `@ai-scraper/application-ai` (contratos `AIProvider*`;
  no se redeclaran tipos del puerto en el adaptador, `R-HX-11`).
- **Superficie pública**:
  - `createAIProvider` / `createAIProviderForJob` / `resolveProviderKind` — eligen el
    proveedor a partir de `AI_PROVIDER` (`openrouter` por defecto, `custom` para
    Ollama/vLLM) — `R-AI-9`.
  - `OpenRouterProvider`, `CustomEndpointProvider`, `FallbackAIProvider` — los
    adaptadores; `FallbackAIProvider` salta de modelo **solo** ante `404`/`429`
    (`OPENROUTER_FALLBACK_MODELS`) — `R-AI-11`.
  - `CircuitBreaker`, `withCircuitBreaker`, `getCircuitBreaker` — aísla un proveedor
    caído y hace fallar rápido; un job nunca queda colgado — `R-AI-14`.
  - `postChatCompletions`, `parseJsonResponse` — la llamada y el parseo defensivo de la
    respuesta del modelo.
  - `DSL_SPEC` y los prompts — el contrato que se le declara al modelo — `R-AI-8`.

> El modelo principal y sus alternativas son **configuración** (`OPENROUTER_MODEL`,
> `OPENROUTER_FALLBACK_MODELS`), nunca IDs hardcodeados (`R-AI-10`).

## Comandos

```bash
npm run build -w @ai-scraper/infrastructure-ai-providers
node --test tests/ai-providers.test.mjs tests/resilience.test.mjs
```
