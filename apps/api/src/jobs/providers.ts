import { createJobStore, createScheduleStore, createSessionStore, createUserRepository } from '@ai-scraper/infrastructure-storage';
import { createJobQueue } from '@ai-scraper/infrastructure-queue';
import { createScheduleCrudUseCases, type ScheduleStore } from '@ai-scraper/application-execution';
import { jobUrlPolicy } from './policy';

export const JOB_STORE = 'JOB_STORE';
export const JOB_QUEUE = 'JOB_QUEUE';
export const SESSION_STORE = 'SESSION_STORE';
export const USER_REPOSITORY = 'USER_REPOSITORY';
export const SCHEDULE_STORE = 'SCHEDULE_STORE';
export const SCHEDULE_USE_CASES = 'SCHEDULE_USE_CASES';
export const RADIOGRAPHER = 'RADIOGRAPHER';

/** Radiografía inyectable (test override). */
export type Radiographer = (url: string, headers?: Record<string, string>) => Promise<void>;

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

export const userRepositoryProvider = {
  provide: USER_REPOSITORY,
  useFactory: () => createUserRepository(),
};

export const scheduleStoreProvider = {
  provide: SCHEDULE_STORE,
  useFactory: () => createScheduleStore(),
};

export const scheduleUseCasesProvider = {
  provide: SCHEDULE_USE_CASES,
  useFactory: (store: ScheduleStore) => createScheduleCrudUseCases({ store, policy: jobUrlPolicy() }),
  inject: [SCHEDULE_STORE],
};

export const radiographerProvider = {
  provide: RADIOGRAPHER,
  useFactory: (): Radiographer => async (url: string, headers?: Record<string, string>) => {
    const { runRadiography } = await import('./radiography-adapter');
    await runRadiography(url, { maxDepth: 2, maxPages: 10, forceBrowser: true, ...(headers ? { headers } : {}) });
  },
};
