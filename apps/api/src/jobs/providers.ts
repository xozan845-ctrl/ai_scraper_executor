import { createJobStore, createSessionStore } from '@ai-scraper/storage';
import { createJobQueue } from '@ai-scraper/queue';

export const JOB_STORE = 'JOB_STORE';
export const JOB_QUEUE = 'JOB_QUEUE';
export const SESSION_STORE = 'SESSION_STORE';
export const RADIOGRAPHER = 'RADIOGRAPHER';

/** Radiografía inyectable (test override). */
export type Radiographer = (url: string) => Promise<void>;

/** Providers async: Prisma/BullMQ si responden, si no memoria (con aviso en log). */
export const storeProvider = {
  provide: JOB_STORE,
  useFactory: () => createJobStore(),
};

export const queueProvider = {
  provide: JOB_QUEUE,
  useFactory: () => createJobQueue(),
};

export const sessionStoreProvider = {
  provide: SESSION_STORE,
  useFactory: () => createSessionStore(),
};

export const radiographerProvider = {
  provide: RADIOGRAPHER,
  useFactory: (): Radiographer => async (url: string) => {
    const { performRadiography } = await import('@ai-scraper/mongodb');
    await performRadiography(url, { maxDepth: 2, maxPages: 10, forceBrowser: true });
  },
};
