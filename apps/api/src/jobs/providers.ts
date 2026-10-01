import { createJobStore } from '@ai-scraper/storage';
import { createJobQueue } from '@ai-scraper/queue';

export const JOB_STORE = 'JOB_STORE';
export const JOB_QUEUE = 'JOB_QUEUE';

/** Providers async: Prisma/BullMQ si responden, si no memoria (con aviso en log). */
export const storeProvider = {
  provide: JOB_STORE,
  useFactory: () => createJobStore(),
};

export const queueProvider = {
  provide: JOB_QUEUE,
  useFactory: () => createJobQueue(),
};
