# worker

El **motor en marcha**: consume la cola y ejecuta el bucle Observe→Think→Act
(planifica con la IA, ejecuta con el DSL, recupera y persiste). Es la capa de
ejecución/orquestación (`R-AR-2`).

- **Dependencias exclusivas**: los packages `ai`, `ai-providers`, `commands`,
  `execution-engine`, `crawler`, `mongodb`, `redis`, `storage`, `queue`, `core` y
  `observability`. No usa NestJS.
- **Superficie (interna, no HTTP)**:
  - `AgentRunner` (`agent-runner.ts`) — el bucle del agente con recovery acotado
    (2 intentos) y presupuestos (`R-SC-3`, `R-SC-9`).
  - `planner.ts` — convierte la intención en un plan del DSL y lo valida (`R-AI-3`).
  - `browser-engine.ts` / `job-processor.ts` — motor de producción y consumo de la cola
    BullMQ, con reintentos hacia `scraping-jobs-dead` (`R-SC-8`).
  - `interpret.js` — interpretación opcional del resultado (`AI_INTERPRET=1`).

> Todo comando que ejecuta pasó por `CommandValidator` y respeta `clampCommandLimits`
> (`R-AR-1`, `R-SC-2`). El worker necesita **Chromium** en su imagen
> (`node:22-bookworm-slim`, ver [`README` raíz](../../README.md)).

## Comandos

```bash
npm run build -w worker
npm run dev:worker        # ts-node --transpile-only, recarga en desarrollo
npm run start -w worker   # node dist/main.js
```

> Requiere Redis (cola) y Postgres/Mongo; puede escalarse con
> `docker compose up --scale worker=3` (ver [`docs/rules/cd/`](../../docs/rules/cd/README.md)).
