import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { metrics } from '@ai-scraper/shared-observability';

/**
 * Instrumentación RED de todas las rutas HTTP (R-TM-4): cuenta peticiones por
 * método, ruta (patrón) y status, y acumula la duración. Las etiquetas son de baja
 * cardinalidad (R-TM-3): `method` es un enum HTTP y `route` es el patrón de Nest
 * (`/api/v1/jobs/:id`), nunca la URL con IDs.
 */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<{ method?: string; route?: { path?: string }; baseUrl?: string; path?: string }>();
    const res = http.getResponse<{ statusCode?: number }>();
    const start = process.hrtime.bigint();

    return next.handle().pipe(
      finalize(() => {
        const route = `${req.baseUrl ?? ''}${req.route?.path ?? req.path ?? 'unknown'}`;
        const labels = {
          method: req.method ?? 'GET',
          status: String(res.statusCode ?? 500),
          route,
        };
        metrics().inc('http_requests_total', 1, labels);
        metrics().inc('http_request_duration_ms_total', Number(process.hrtime.bigint() - start) / 1e6, labels);
      }),
    );
  }
}
