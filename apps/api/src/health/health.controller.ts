import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { JobQueue, JobStore } from '@ai-scraper/application-execution';
import { JOB_STORE, JOB_QUEUE } from '../jobs/providers';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(JOB_STORE) private readonly store: JobStore,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  /** Liveness: proceso vivo (sin dependencias). */
  @Get()
  check() {
    return { status: 'ok', service: 'api', time: new Date().toISOString() };
  }

  /** Readiness: comprueba dependencias (store + cola). 503 si alguna falla. */
  @Get('ready')
  async ready() {
    const checks: Record<string, string> = { store: this.store.kind, queue: this.queue.kind };
    if (process.env.NODE_ENV === 'production' && (this.store.kind === 'memory' || this.queue.kind === 'memory')) {
      throw new ServiceUnavailableException({ status: 'error', checks, reason: 'dependencia en memoria no apta para producción' });
    }
    try {
      await this.store.getStats();
    } catch (e) {
      checks.store = `error: ${(e as Error).message}`;
      throw new ServiceUnavailableException({ status: 'error', checks });
    }
    try {
      await this.queue.pendingCount();
    } catch (e) {
      checks.queue = `error: ${(e as Error).message}`;
      throw new ServiceUnavailableException({ status: 'error', checks });
    }
    return { status: 'ok', service: 'api', checks, time: new Date().toISOString() };
  }
}
