import { Module } from '@nestjs/common';
import { JobsModule } from './jobs/jobs.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [JobsModule],
  controllers: [HealthController],
})
export class AppModule {}
