export interface ScrapingJobPayload {
  jobId: string;
  url: string;
  instruction: string;
  limits?: Record<string, number>;
  ai?: { provider?: string; model?: string };
  priority?: number;
  correlationId?: string;
}
