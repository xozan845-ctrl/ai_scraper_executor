# Reglas de Observability — AI Web Scraping Executor

Reglas de **observabilidad** en dos documentos que se aplican juntos: logs
estructurados con correlación de extremo a extremo (`01-logs.md`) y métricas
Prometheus con dashboard y alertas (`02-telemetria.md`).

> En este proyecto la correlación no es un lujo: un job pasa por la API, la cola,
> varios comandos, páginas, el LLM y el navegador, y sin un identificador común es
> imposible reconstruir qué pasó. El `correlationId` es la regla que más se nota cuando
> falta.

## Archivos

| Archivo | Contenido | Sufijo |
|---|---|---|
| `01-logs.md` | Logging JSON, `correlationId` por `AsyncLocalStorage`, niveles, sanitización | `R-OB` (1–6) |
| `02-telemetria.md` | `/api/v1/metrics` y `/api/v1/metrics/prometheus`, naming `scraper_*`, labels, RED, métricas distribuidas, `/api/v1/health`, dashboard | `R-TM` (1–9) |

> Los documentos derivados de este área (**AUDIT, CHECKLIST, historiales**) no viven
> aquí: están en [`../_meta/`](../_meta/README.md). Un área de reglas solo contiene
> `README.md` + archivos `NN-tema.md`.

## Mapa de IDs

| Prefijo | Rango | Archivo | Ámbito |
|---|---|---|---|
| `R-OB-*` | 1–6 | `01-logs.md` | Logs estructurados y correlación |
| `R-TM-*` | 1–9 | `02-telemetria.md` | Métricas, dashboard, health y alertas |

## Reglas de otras áreas que exige esta (cross-refs)

| ID | Exigencia |
|---|---|
| `R-OB-2` | La correlación nace en la API y viaja por la cola → `R-AR-3` (`../architecture/01-arquitectura.md`) |
| `R-OB-3` | Nombres de métrica ASCII → `R-TM-2` (mismo área) |
| `R-OB-6` | Sin secretos en logs → `R-DS-6` (`../data/02-seguridad.md`) y `R-SE-11` (`../security/02-acceso.md`) |
| `R-TM-2` | El prefijo es `scraper_*` → `R-TM-1` (mismo archivo) |
| `R-TM-3` | El label `instance` es lo que permite escalar el worker → `R-AR-3` (`../architecture/01-arquitectura.md`) |
| `R-TM-5` | La cola de muertos avisa por crecimiento, no por existir → `R-AR-8` (`../architecture/01-arquitectura.md`) |
| `R-TM-6` | Métricas distribuidas → `R-RD-6` (`../db/03-redis.md`) |
| `R-TM-8` | Readiness y el arranque tardío → `R-DI-6` (`../data/01-integridad.md`) |

## Pendientes

- **No hay Grafana provisionado en el repo**: no existe `infra/grafana/` ni
  `docker-compose.observability.yml`. El dashboard que existe es el SPA de
  `/api/v1/dashboard` (autorefresco 5 s). Las alertas de `R-TM-5` y `R-TM-9` son
  hoy un contrato, no una configuración existente → deuda en
  [`../_meta/AUDIT.md`](../_meta/AUDIT.md).
- Las métricas RED están expuestas **por endpoint y por log**, no por instrumentación
  automática del servidor HTTP: las latencias se miden por `withSpan` en los puntos
  que se marcaron, no en todas las rutas.
