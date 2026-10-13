import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { DashboardController } from './dashboard.controller';
import { RadiographyController } from './radiography.controller';
import { RadiographyService } from './radiography.service';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { FirstUserController } from './first-user.controller';
import { UserService } from './user.service';
import { HealthController } from '../health/health.controller';
import { ApiKeyGuard } from './api-key.guard';
import { CreateRateLimitGuard } from './rate-limit.guard';
import { FirstRunGuard } from './first-run.guard';
import { storeProvider, queueProvider, sessionStoreProvider, radiographerProvider } from './providers';

@Module({
  controllers: [
    JobsController,
    MetricsController,
    DashboardController,
    RadiographyController,
    SessionsController,
    FirstUserController,
    HealthController,
  ],
  providers: [
    JobsService,
    MetricsService,
    RadiographyService,
    SessionsService,
    UserService,
    ApiKeyGuard,
    CreateRateLimitGuard,
    FirstRunGuard,
    storeProvider,
    queueProvider,
    sessionStoreProvider,
    radiographerProvider,
  ],
})
export class JobsModule {}

