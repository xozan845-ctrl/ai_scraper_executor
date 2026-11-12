import type { JobLimits } from '../value-objects/job-limits';

export enum JobStatus {
  CREATED = 'CREATED',
  QUEUED = 'QUEUED',
  PLANNING = 'PLANNING',
  EXPLORING = 'EXPLORING',
  EXECUTING = 'EXECUTING',
  RECOVERING = 'RECOVERING',
  INTERPRETING = 'INTERPRETING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  TIMEOUT = 'TIMEOUT',
}

export interface CreateJobInput {
  url: string;
  instruction: string;
  limits?: JobLimits;
  ai?: {
    provider?: 'openrouter' | 'custom';
    model?: string;
  };
}

export interface JobRecord extends CreateJobInput {
  id: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
}
