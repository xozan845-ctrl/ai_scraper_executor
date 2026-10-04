import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { MetricsController } from './metrics.controller';
import { DashboardController } from './dashboard.controller';
import { ApiKeyGuard } from './api-key.guard';
import { CreateRateLimitGuard } from './rate-limit.guard';
import { storeProvider, queueProvider } from './providers';

@Module({
  controllers: [JobsController, MetricsController, DashboardController],
  providers: [JobsService, ApiKeyGuard, CreateRateLimitGuard, storeProvider, queueProvider],
})
export class JobsModule {}
