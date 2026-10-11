# worker

El **adaptador de entrada de la cola**: arranca el proceso, compone dependencias y
consume jobs. El bucle Observe→Think→Act es lógica de aplicación y su destino es
`libs/application/*` (`R-HX-10`).

- **Dependencias exclusivas**: las libs `application-ai`, `application-execution`,
  `domain-*`, los adaptadores de infraestructura y `shared-observability` declarados
  en `package.json`. No usa NestJS.
- **Superficie (interna, no HTTP)**:
  - `AgentRunner` (`agent-runner.ts`) — el bucle del agente con recovery acotado
    (2 intentos) y presupuestos (`R-SC-3`, `R-SC-9`). Fase B incluye **memoria de trayectoria**
    (últimos 8 pasos, items, URLs visitadas) que se pasa a `analyzePage`/`recover` y una
    **guardia anti-oscilación determinista** que salta comandos repetidos fallidos (ADR-35).
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

> **Deuda F8–F9 (ADR-33):** `AgentRunner`, planner, browser engine e implementación de
> `job-processor` todavía viven en la app. `job-processor` ya depende de los puertos de
> `application-execution`, pero la coordinación debe quedar como casos de uso en
> `libs/application/{execution,scraper}`; aquí quedarán bootstrap, consumer y wiring.
