import { createHmac } from 'node:crypto';
import type { WebhookEvent, WebhookNotifier } from '@ai-scraper/application-scraper';
import { HttpError, safePostJson } from '@ai-scraper/shared-security';

export interface WebhookNotifierOptions {
  /** Secreto HMAC-SHA256; si falta, el POST va sin firma. */
  secret?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  /** Solo dev/tests: permite hosts privados (nunca en producción). */
  allowPrivateHosts?: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(error: unknown): boolean {
  if (error instanceof HttpError) {
    if (error.status === 429 || error.status === 408 || error.status >= 500) return true;
    return false;
  }
  return true;
}

/**
 * Notificador HTTP de webhooks: firma HMAC, SSRF centralizado, sin redirects y
 * reintentos con backoff. Un 4xx determinista no se reintenta.
 */
export class HttpWebhookNotifier implements WebhookNotifier {
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;

  constructor(private readonly options: WebhookNotifierOptions = {}) {
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 3);
    this.baseDelayMs = Math.max(0, options.baseDelayMs ?? 250);
  }

  async notify(webhookUrl: string, event: WebhookEvent): Promise<void> {
    const body = JSON.stringify(event);
    const headers: Record<string, string> = {
      'User-Agent': 'ai-scraper-executor/webhook',
      'X-Webhook-Event': event.event,
      'X-Webhook-Id': event.jobId,
      'X-Webhook-Timestamp': event.timestamp,
    };
    if (this.options.secret) {
      const digest = createHmac('sha256', this.options.secret).update(body).digest('hex');
      headers['X-Webhook-Signature'] = `sha256=${digest}`;
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        await safePostJson(webhookUrl, event, {
          headers,
          timeoutMs: this.options.timeoutMs ?? 5000,
          ...(this.options.allowPrivateHosts !== undefined
            ? { allowPrivateHosts: this.options.allowPrivateHosts }
            : {}),
        });
        return;
      } catch (error) {
        lastError = error;
        if (!isRetryable(error) || attempt === this.maxAttempts) break;
        await sleep(this.baseDelayMs * 2 ** (attempt - 1));
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Webhook fallido');
  }
}
