# @ai-scraper/ai

El **orquestador de IA** del producto: compone el contexto que se envía al modelo y
gobierna las fases (planificar, analizar, recuperar, interpretar). No habla con el
proveedor: eso es `@ai-scraper/infrastructure-ai-providers` (`R-AR-7`).

- **Capa**: inteligencia.
- **Dependencias exclusivas**: `zod` (valida la salida del modelo antes de darla por buena).
- **Superficie pública**:
  - `AIOrchestrator` — ejecuta las fases con el `AIProvider` inyectado.
  - `buildMinimalContext` — construye el contexto del planner con el perfil aprendido,
    la página actual y los límites del job (`R-AI-15`); el perfil es una **pista**, no
    una orden (`R-AI-16`).
  - `SYSTEM_GUARDRAILS` y los prompts (`PLAN_/ANALYZE_/RECOVER_/INTERPRET_SYSTEM_PROMPT`)
    — declaran el esquema DSL y prohíben comandos inventados — `R-AI-8`.

## Comandos

```bash
npm run build -w @ai-scraper/ai
node --test tests/agent.test.mjs tests/interpret.test.mjs tests/llm-cache.test.mjs
```
