import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { runWithContext } from '@ai-scraper/observability';
import { closeJobStore } from '@ai-scraper/storage';
import { closeJobQueue } from '@ai-scraper/queue';
import { disconnectMongo } from '@ai-scraper/mongodb';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors();
  app.enableShutdownHooks();
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
