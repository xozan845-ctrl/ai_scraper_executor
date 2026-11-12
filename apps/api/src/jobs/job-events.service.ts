import { Injectable } from '@nestjs/common';
import { subscribeProgress } from '@ai-scraper/infrastructure-redis';
import type { ProgressEvent } from '@ai-scraper/application-scraper';

/** Aísla del controller el bus de progreso (Redis/memoria) — R-HX-10/SRP. */
@Injectable()
export class JobEventsService {
  subscribe(jobId: string, handler: (event: ProgressEvent) => void): Promise<() => void> {
    return subscribeProgress(jobId, handler);
  }
}
