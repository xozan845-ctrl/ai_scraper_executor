export type ProgressEventType =
  | 'job.started'
  | 'job.status'
  | 'observe'
  | 'decision'
  | 'recovery'
  | 'step'
  | 'job.finished';

export interface ProgressEvent {
  type: ProgressEventType;
  jobId: string;
  at: string;
  step?: number;
  url?: string;
  status?: string;
  commandType?: string;
  ok?: boolean;
  count?: number;
  itemsCount?: number;
  error?: string;
  message?: string;
  depth?: number;
  links?: number;
  elements?: number;
  htmlLength?: number;
  attempt?: number;
  maxAttempts?: number;
}

export type ProgressListener = (event: ProgressEvent) => void;
