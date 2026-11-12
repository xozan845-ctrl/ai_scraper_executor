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
import { SchedulesController } from './schedules.controller';
import { SchedulesService } from './schedules.service';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';
import { AdminGuard } from './admin.guard';
import { UserService } from './user.service';
import { HealthController } from '../health/health.controller';
import { ApiKeyGuard } from './api-key.guard';
import { CreateRateLimitGuard } from './rate-limit.guard';
import { FirstRunGuard } from './first-run.guard';
import { storeProvider, queueProvider, sessionStoreProvider, userRepositoryProvider, scheduleStoreProvider, scheduleUseCasesProvider, apiKeyUseCasesProvider, radiographerProvider } from './providers';

@Module({
  controllers: [
    JobsController,
    MetricsController,
    DashboardController,
    RadiographyController,
    SessionsController,
    FirstUserController,
    SchedulesController,
    ApiKeysController,
    HealthController,
  ],
  providers: [
    JobsService,
    MetricsService,
    RadiographyService,
    SessionsService,
    UserService,
    SchedulesService,
    ApiKeysService,
    ApiKeyGuard,
    AdminGuard,
    CreateRateLimitGuard,
    FirstRunGuard,
    storeProvider,
    queueProvider,
    sessionStoreProvider,
    userRepositoryProvider,
    scheduleStoreProvider,
    scheduleUseCasesProvider,
    apiKeyUseCasesProvider,
    radiographerProvider,
  ],
})
export class JobsModule {}

