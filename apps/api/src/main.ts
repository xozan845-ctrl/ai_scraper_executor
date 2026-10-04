import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors();
  if (process.env.NODE_ENV === 'production' && !process.env.API_KEYS) {
    console.error('[API] ⚠️  NODE_ENV=production sin API_KEYS: la autenticación está CERRADA (todas las rutas protegidas devolverán 401).');
  }
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`[API] listening on :${port}`);
}
bootstrap();
