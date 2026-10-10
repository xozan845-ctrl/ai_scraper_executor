export interface SessionRecord {
  id: string;
  url: string;
  domain: string;
  status: string;
  credentials?: string | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
  ownerScope: string;
}

export interface SessionMessageRecord {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  jobId?: string | null;
  createdAt: string;
}

export interface CreateSessionInput {
  url: string;
  domain: string;
  credentials?: string | null;
  ownerScope?: string;
}
