import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { MetricsController } from './metrics.controller';
import { DashboardController } from './dashboard.controller';
import { RadiographyController } from './radiography.controller';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { HealthController } from '../health/health.controller';
import { ApiKeyGuard } from './api-key.guard';
import { CreateRateLimitGuard } from './rate-limit.guard';
import { storeProvider, queueProvider, sessionStoreProvider, radiographerProvider } from './providers';

@Module({
  controllers: [
    JobsController,
    MetricsController,
    DashboardController,
    RadiographyController,
    SessionsController,
    HealthController,
  ],
  providers: [JobsService, SessionsService, ApiKeyGuard, CreateRateLimitGuard, storeProvider, queueProvider, sessionStoreProvider, radiographerProvider],
})
export class JobsModule {}
