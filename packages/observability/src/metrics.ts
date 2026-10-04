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

/**
 * Identidad de la réplica (ETAPA 5, multi-worker --scale N).
 * Fijable vía INSTANCE_ID (tests deterministas); por defecto hostname-pid.
 */
export function instanceId(): string {
  const fixed = (process.env.INSTANCE_ID ?? '').trim();
  if (fixed) return fixed;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const os = require('node:os') as { hostname?: () => string };
    const host = typeof os.hostname === 'function' ? os.hostname() : 'unknown';
    return `${host}-${process.pid}`;
  } catch {
    return `pid-${process.pid}`;
  }
}

export class MetricsCollector {
  private counters = new Map<string, Counter[]>();
  private gauges = new Map<string, { value: number; labels: MetricLabels }>();
  private readonly prefix: string;
  private readonly startedAt = Date.now();
  readonly instance: string;

  constructor(prefix = 'scraper', instance?: string) {
    this.prefix = prefix;
    this.instance = instance ?? instanceId();
  }

  /** Segundos desde la creación del collector (uptime de la réplica). */
  uptimeSec(): number {
    return Math.floor((Date.now() - this.startedAt) / 1000);
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

  /** Formato Prometheus text exposition (listo para Grafana §38).
   * ETAPA 5: cada serie lleva label `instance` para agregar multi-réplica
   * con `sum by (…)`; `scraper_instance_info` y `scraper_uptime_seconds`
   * identifican la réplica.
   */
  toPrometheus(): string {
    const lines: string[] = [];
    const withInstance = (labels: MetricLabels): string =>
      renderLabels({ ...labels, instance: this.instance });
    for (const [name, list] of this.counters) {
      lines.push(`# TYPE ${name} counter`);
      for (const c of list) lines.push(`${name}${withInstance(c.labels)} ${c.value}`);
    }
    for (const [name, g] of this.gauges) {
      lines.push(`# TYPE ${name} gauge`);
      lines.push(`${name}${withInstance(g.labels)} ${g.value}`);
    }
    lines.push(`# TYPE ${this.prefix}_instance_info gauge`);
    lines.push(`${this.prefix}_instance_info${renderLabels({ instance: this.instance })} 1`);
    lines.push(`# TYPE ${this.prefix}_uptime_seconds gauge`);
    lines.push(`${this.prefix}_uptime_seconds${renderLabels({ instance: this.instance })} ${this.uptimeSec()}`);
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
