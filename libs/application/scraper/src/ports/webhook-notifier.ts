export type WebhookEventName = 'job.completed' | 'job.failed' | 'job.timeout' | 'job.cancelled' | 'job.needs_human';

export interface WebhookEvent {
  event: WebhookEventName;
  jobId: string;
  status: string;
  url: string;
  itemsCount: number;
  error?: string;
  timestamp: string;
}

/** Puerto de notificación externa; el adaptador HTTP vive en infraestructura. */
export interface WebhookNotifier {
  notify(webhookUrl: string, event: WebhookEvent): Promise<void>;
}
