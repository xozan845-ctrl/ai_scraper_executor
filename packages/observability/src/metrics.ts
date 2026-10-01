/**
 * Collector de métricas §56 en memoria (proceso local).
 * La verdad cruzada entre procesos vive en storage (getStats); esto mide
 * el proceso actual y se expone en GET /metrics junto a los stats de DB.
 *
 * Métricas (§56): jobs_total/created/completed/failed, pages_scraped,
 * commands_total, items_extracted, recovery_count, ai_requests, ai_tokens,
 * ai_errors. De `recoveries/completed` sale el AI Recovery Rate.
 */
export type MetricLabels = Record<string, string>;

interface Counter {
  value: number;
  labels: MetricLabels;
}

export class MetricsCollector {
  private counters = new Map<string, Counter[]>();
  private gauges = new Map<string, { value: number; labels: MetricLabels }>();
  private readonly prefix: string;

  constructor(prefix = 'scraper') {
    this.prefix = prefix;
  }

  inc(name: string, by = 1, labels: MetricLabels = {}): void {
    const key = `${this.prefix}_${name}`;
    const list = this.counters.get(key) ?? [];
    const slot = list.find((c) => shallowEqual(c.labels, labels));
    if (slot) slot.value += by;
    else list.push({ value: by, labels: { ...labels } });
    this.counters.set(key, list);
  }

  gauge(name: string, value: number, labels: MetricLabels = {}): void {
    this.gauges.set(`${this.prefix}_${name}`, { value, labels: { ...labels } });
  }

  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [name, list] of this.counters) {
      out[name] = list.reduce((acc, c) => acc + c.value, 0);
    }
    for (const [name, g] of this.gauges) out[name] = g.value;
    return out;
  }

  /** Formato Prometheus text exposition (listo para Grafana §38). */
  toPrometheus(): string {
    const lines: string[] = [];
    for (const [name, list] of this.counters) {
      lines.push(`# TYPE ${name} counter`);
      for (const c of list) lines.push(`${name}${renderLabels(c.labels)} ${c.value}`);
    }
    for (const [name, g] of this.gauges) {
      lines.push(`# TYPE ${name} gauge`);
      lines.push(`${name}${renderLabels(g.labels)} ${g.value}`);
    }
    return `${lines.join('\n')}\n`;
  }
}

function shallowEqual(a: MetricLabels, b: MetricLabels): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => a[k] === b[k]);
}

function renderLabels(labels: MetricLabels): string {
  const keys = Object.keys(labels);
  if (keys.length === 0) return '';
  return `{${keys.map((k) => `${k}="${labels[k]}"`).join(',')}}`;
}

/** Singleton del proceso (API o worker). */
let singleton: MetricsCollector | null = null;

export function metrics(): MetricsCollector {
  if (!singleton) singleton = new MetricsCollector();
  return singleton;
}

/** Solo tests: resetea el singleton. */
export function __resetMetrics(): void {
  singleton = null;
}
