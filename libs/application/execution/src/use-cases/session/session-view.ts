import type { SessionRecord } from '../../dtos/session';

export interface SessionView {
  id: string;
  url: string;
  domain: string;
  status: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Proyección pública de una sesión: nunca expone credenciales ni ownerScope. */
export function toSessionView(record: SessionRecord): SessionView {
  return {
    id: record.id,
    url: record.url,
    domain: record.domain,
    status: record.status,
    error: record.error ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
