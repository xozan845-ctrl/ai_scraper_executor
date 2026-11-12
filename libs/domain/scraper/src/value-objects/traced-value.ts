export interface TracedValue<T = unknown> {
  value: T;
  source: {
    url: string;
    selector?: string;
    scrapedAt: string;
    confidence?: number;
  };
}

export interface StructuredItem {
  [key: string]: TracedValue | unknown;
}
