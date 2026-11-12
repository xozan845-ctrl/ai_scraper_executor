# worker

El **adaptador de entrada de la cola**: arranca el proceso, compone dependencias y
consume jobs. El workflow Observe→Think→Act vive en `application/scraper` (`R-HX-10`).

- **Dependencias exclusivas**: las libs `application-ai`, `application-execution`,
  `application-scraper`, `domain-*`, los adaptadores de infraestructura y
  `shared-observability` declarados en `package.json`. No usa NestJS.
- **Superficie (interna, no HTTP)**:
  - `main.ts` — bootstrap, consumer BullMQ, DLQ, apagado graceful y wiring de los
    casos de uso (`processJob`, `AgentRunner`) con sus puertos.
  - `browser-engine.ts` — composición del motor de producción (Cheerio con escalado a
    Chromium, caché Redis y rate limit por host, `R-SC-7`).
  - `site-memory.ts` — adaptador MongoDB del puerto `SiteMemory`.
  - `metrics-bridge.ts` — métricas locales + agregador Redis (fire-and-forget).
- El loop heurístico sin IA para `DEMO_URL` (`runHeuristicAgentLoop`) también vive
  en `application/scraper` y recibe el motor inyectado.

El bucle del agente, el planner, el procesador de jobs y la interpretación de
resultados viven en [`libs/application/scraper`](../../libs/application/scraper/README.md).

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

> **Deuda F9 (ADR-33):** queda concentrar/adelgazar la composición restante
> (`main.ts`, `browser-engine.ts`, `site-memory.ts`) y cerrar el enforcement de
> `R-HX-14`; los casos de uso ya están fuera de la app.
