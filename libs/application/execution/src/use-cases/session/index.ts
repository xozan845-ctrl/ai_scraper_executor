import type { SessionStore } from '../../ports/session-store';
import type {
  RadiographyRunner,
  SessionCredentials,
  SessionJobGateway,
  SiteProfileReader,
} from '../../ports/session-integrations';
import type { JobUrlPolicy } from '../job/job-url-policy';
import { CreateSessionUseCase } from './create-session';
import { SendSessionMessageUseCase } from './send-session-message';
import { SessionQueries } from './session-queries';

export * from './errors';
export * from './session-view';
export * from './create-session';
export * from './session-queries';
export * from './send-session-message';

export interface SessionUseCaseDeps {
  sessions: SessionStore;
  jobs: SessionJobGateway;
  radiography: RadiographyRunner;
  profileReader: SiteProfileReader;
  credentials: SessionCredentials;
  urlPolicy: JobUrlPolicy;
  radiographyConcurrency?: number;
  radiographyTimeoutMs?: number;
  staleAfterMs?: number;
}

export interface SessionUseCases {
  create: CreateSessionUseCase;
  queries: SessionQueries;
  sendMessage: SendSessionMessageUseCase;
}

/** Composition de casos de uso de sesiones; no instancia adaptadores (`R-HX-5`). */
export function createSessionUseCases(deps: SessionUseCaseDeps): SessionUseCases {
  return {
    create: new CreateSessionUseCase(deps),
    queries: new SessionQueries(deps),
    sendMessage: new SendSessionMessageUseCase(deps),
  };
}
