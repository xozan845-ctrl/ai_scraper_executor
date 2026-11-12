import type { SessionMessageRecord } from '../../dtos/session';
import type { SessionStore } from '../../ports/session-store';
import type { SessionJobGateway } from '../../ports/session-integrations';
import { SessionNotReadyError } from './errors';

export interface SendSessionMessageCommand {
  sessionId: string;
  instruction: string;
  scope?: string;
}

export interface SendSessionMessageDeps {
  sessions: SessionStore;
  jobs: SessionJobGateway;
}

export interface SendSessionMessageResult {
  message: SessionMessageRecord;
  jobId: string;
  jobStatus: string;
}

/** Envía una instrucción: exige sesión READY y crea un job con el contexto de la sesión. */
export class SendSessionMessageUseCase {
  constructor(private readonly deps: SendSessionMessageDeps) {}

  async execute(command: SendSessionMessageCommand): Promise<SendSessionMessageResult | null> {
    const scope = command.scope ?? 'anon';
    const session = await this.deps.sessions.getSession(command.sessionId, scope);
    if (!session) return null;
    if (session.status !== 'READY') throw new SessionNotReadyError();

    await this.deps.sessions.addMessage(session.id, 'user', command.instruction);
    const job = await this.deps.jobs.createJob({
      url: session.url,
      instruction: command.instruction,
      sessionId: session.id,
      scope,
    });
    const assistant = await this.deps.sessions.addMessage(session.id, 'assistant', 'Analizando la página…', job.id);
    return { message: assistant, jobId: job.id, jobStatus: job.status };
  }
}
