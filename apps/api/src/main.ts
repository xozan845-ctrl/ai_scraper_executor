import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { closeJobStore } from '@ai-scraper/storage';
import { closeJobQueue } from '@ai-scraper/queue';
import { disconnectMongo } from '@ai-scraper/mongodb';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors();
  app.enableShutdownHooks();
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
