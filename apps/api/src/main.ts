import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ExpressAdapter } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { runWithContext } from '@ai-scraper/shared-observability';
import { closeJobStore } from '@ai-scraper/infrastructure-storage';
import { closeJobQueue } from '@ai-scraper/infrastructure-queue';
import { disconnectMongo } from '@ai-scraper/infrastructure-mongodb';
import { HttpMetricsInterceptor } from './jobs/http-metrics.interceptor';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, new ExpressAdapter());
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Instrumentación RED de todas las rutas (R-TM-4).
  app.useGlobalInterceptors(new HttpMetricsInterceptor());
  // CORS: allowlist explícita por CORS_ORIGINS. En producción sin allowlist NO se
  // emiten cabeceras CORS (mismo origen); en dev/test se mantiene abierto.
  const corsOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (corsOrigins.length > 0) app.enableCors({ origin: corsOrigins });
  else if (process.env.NODE_ENV !== 'production') app.enableCors();
  // trust proxy: necesario detrás de LB/reverse proxy para que req.ip (rate-limit) sea real.
  const trustProxy = (process.env.TRUST_PROXY ?? '').trim();
  if (trustProxy) {
    const instance = app.getHttpAdapter().getInstance() as { set?: (k: string, v: unknown) => void };
    instance.set?.('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
  }
  // Cabeceras de seguridad básicas (sin dependencias externas).
  app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.enableShutdownHooks();
  // OpenAPI/Swagger en /api/v1/docs
  const swaggerConfig = new DocumentBuilder()
    .setTitle('AI Scraping Executor API')
    .setDescription('LA IA ES EL CEREBRO. CRAWLEE ES EL MOTOR.')
    .setVersion('0.1.0')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-api-key' }, 'api-key')
    .build();
  SwaggerModule.setup('api/v1/docs', app, SwaggerModule.createDocument(app, swaggerConfig));
  // Correlación: acepta x-correlation-id entrante o genera uno; lo propaga por contexto y respuesta.
  app.use((req: { headers: Record<string, unknown> }, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    const incoming = req.headers['x-correlation-id'];
    const correlationId = typeof incoming === 'string' && incoming ? incoming : randomUUID();
    res.setHeader('x-correlation-id', correlationId);
    runWithContext({ correlationId }, () => next());
  });
  if (process.env.NODE_ENV === 'production' && !process.env.API_KEYS) {
    console.error('[API] ⚠️  NODE_ENV=production sin API_KEYS: la autenticación está CERRADA (todas las rutas protegidas devolverán 401).');
  }

  // Apagado graceful: cierra conexiones al recibir SIGTERM/SIGINT.
  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`[API] ${signal} — apagando...`);
    try {
      await app.close();
    } catch (e) {
      console.error('[API] error cerrando app:', (e as Error).message);
    }
    await closeJobQueue().catch(() => undefined);
    await closeJobStore().catch(() => undefined);
    await disconnectMongo().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`[API] listening on :${port}`);
}
bootstrap();
