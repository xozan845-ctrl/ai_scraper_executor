import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { MetricsController } from './metrics.controller';
import { DashboardController } from './dashboard.controller';
import { storeProvider, queueProvider } from './providers';

@Module({
  controllers: [JobsController, MetricsController, DashboardController],
  providers: [JobsService, storeProvider, queueProvider],
})
export class JobsModule {}
