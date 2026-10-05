import { getRedisClient, getRedisSubscriber, probeRedis, ensureConnected, Redis } from './connection';

const METRICS_PREFIX = 'metrics:';
const INSTANCE_TTL = 60; // segundos

/**
 * Separa `instance:labels` por el PRIMER ':'. El instanceId nunca contiene ':'
 * (host-pid), pero el JSON de labels sí; `split(':', 2)` lo rompía.
 */
export function parseGaugeField(field: string): { instance: string; labels: string } {
  const idx = field.indexOf(':');
  if (idx === -1) return { instance: field, labels: '' };
  return { instance: field.slice(0, idx), labels: field.slice(idx + 1) };
}

/** Agregador de métricas distribuidas (Redis) */
export class RedisMetricsAggregator {
  private readonly client: Redis;
  private readonly subscriber: Redis;
  private readonly instanceId: string;

  constructor(instanceId?: string) {
    this.client = getRedisClient();
    this.subscriber = getRedisSubscriber();
    this.instanceId = instanceId ?? `${process.env.INSTANCE_ID ?? 'inst'}-${process.pid}`;
  }

  /** Incrementa un contador global (suma across instances) */
  async inc(name: string, by = 1, labels: Record<string, string> = {}): Promise<void> {
    const key = `${METRICS_PREFIX}${name}`;
    const labelStr = JSON.stringify(labels);
    const field = `${this.instanceId}:${labelStr}`;
    await this.client.hincrby(key, field, by);
    await this.client.expire(key, 3600);
    // Publica para agregación en tiempo real
    await this.client.publish(`${METRICS_PREFIX}events`, JSON.stringify({ name, by, labels, instance: this.instanceId, ts: Date.now() }));
  }

  /** Establece un gauge (último valor gana) */
  async gauge(name: string, value: number, labels: Record<string, string> = {}): Promise<void> {
    const key = `${METRICS_PREFIX}${name}:gauge`;
    const labelStr = JSON.stringify(labels);
    const field = `${this.instanceId}:${labelStr}`;
    await this.client.hset(key, field, value.toString());
    await this.client.expire(key, 3600);
  }

  /** Obtiene suma global de un contador */
  async getCounter(name: string, labels?: Record<string, string>): Promise<number> {
    const key = `${METRICS_PREFIX}${name}`;
    if (labels) {
      const labelStr = JSON.stringify(labels);
      const pattern = `*:${labelStr}`;
      const fields = await this.client.hgetall(key) as Record<string, string>;
      return Object.entries(fields)
        .filter(([k]) => k.endsWith(labelStr))
        .reduce((sum: number, [, v]) => sum + parseInt(v, 10), 0);
    }
    const all = await this.client.hgetall(key) as Record<string, string>;
    return Object.values(all).reduce((sum: number, v: string) => sum + parseInt(v, 10), 0);
  }

  /** Itera claves con SCAN (no bloquea Redis como KEYS en producción). */
  private async scanKeys(pattern: string): Promise<string[]> {
    const found: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = next;
      if (batch.length) found.push(...batch);
    } while (cursor !== '0');
    return found;
  }

  /** Obtiene todos los contadores para Prometheus */
  async getAllCounters(): Promise<Record<string, number>> {
    const keys = await this.scanKeys(`${METRICS_PREFIX}*`);
    const result: Record<string, number> = {};
    for (const key of keys) {
      if (key.endsWith(':gauge')) continue;
      const all = await this.client.hgetall(key) as Record<string, string>;
      const metricName = key.replace(METRICS_PREFIX, '');
      result[metricName] = Object.values(all).reduce((sum, v) => sum + parseInt(v, 10), 0);
    }
    return result;
  }

  /** Obtiene todos los gauges (último valor por instance) */
  async getAllGauges(): Promise<Record<string, Record<string, number>>> {
    const keys = await this.scanKeys(`${METRICS_PREFIX}*:gauge`);
    const result: Record<string, Record<string, number>> = {};
    for (const key of keys) {
      const all = await this.client.hgetall(key) as Record<string, string>;
      const metricName = key.replace(METRICS_PREFIX, '').replace(':gauge', '');
      result[metricName] = {};
      for (const [field, value] of Object.entries(all)) {
        const { instance, labels } = parseGaugeField(field);
        result[metricName][`${instance}:${labels}`] = parseFloat(value);
      }
    }
    return result;
  }

  /** Registra heartbeat de esta instancia */
  async heartbeat(): Promise<void> {
    await this.client.setex(`${METRICS_PREFIX}instances:${this.instanceId}`, INSTANCE_TTL, JSON.stringify({
      pid: process.pid,
      startedAt: process.uptime(),
      lastSeen: Date.now(),
    }));
  }

  /** Lista instancias vivas */
  async getLiveInstances(): Promise<string[]> {
    const keys = await this.scanKeys(`${METRICS_PREFIX}instances:*`);
    return keys.map((k: string) => k.split(':').pop()!).filter(Boolean);
  }

  /** Limpia instancias muertas (las expiradas ya no aparecen en Redis). */
  async cleanupDeadInstances(): Promise<void> {
    await this.getLiveInstances();
  }
}

/** Agregador en memoria (fallback/tests) */
export class MemoryMetricsAggregator {
  private readonly counters = new Map<string, Map<string, number>>();
  private readonly gauges = new Map<string, Map<string, number>>();
  private readonly instanceId: string;

  constructor(instanceId?: string) {
    this.instanceId = instanceId ?? `mem-${process.pid}`;
  }

  private key(name: string, labels: Record<string, string> = {}): string {
    return `${name}:${JSON.stringify(labels)}`;
  }

  async inc(name: string, by = 1, labels: Record<string, string> = {}): Promise<void> {
    const k = this.key(name, labels);
    const m = this.counters.get(name) ?? new Map();
    m.set(k, (m.get(k) ?? 0) + by);
    this.counters.set(name, m);
  }

  async gauge(name: string, value: number, labels: Record<string, string> = {}): Promise<void> {
    const k = this.key(name, labels);
    const m = this.gauges.get(name) ?? new Map();
    m.set(k, value);
    this.gauges.set(name, m);
  }

  async getCounter(name: string, labels?: Record<string, string>): Promise<number> {
    if (labels) return this.counters.get(name)?.get(this.key(name, labels)) ?? 0;
    const m = this.counters.get(name);
    return m ? Array.from(m.values()).reduce((a, b) => a + b, 0) : 0;
  }

  async getAllCounters(): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    for (const [name, m] of this.counters) {
      result[name] = Array.from(m.values()).reduce((a, b) => a + b, 0);
    }
    return result;
  }

  async getAllGauges(): Promise<Record<string, Record<string, number>>> {
    const result: Record<string, Record<string, number>> = {};
    for (const [name, m] of this.gauges) {
      result[name] = {};
      for (const [k, v] of m) result[name][k] = v;
    }
    return result;
  }
}

/** Factory */
let metricsInstance: RedisMetricsAggregator | MemoryMetricsAggregator | null = null;

export async function getMetricsAggregator(instanceId?: string): Promise<RedisMetricsAggregator | MemoryMetricsAggregator> {
  if (metricsInstance) return metricsInstance;
  try {
    if ((await isRedisHealthy()) && (await ensureConnected())) {
      metricsInstance = new RedisMetricsAggregator(instanceId);
      console.log('[METRICS] RedisMetricsAggregator activado');
    } else throw new Error('Redis no healthy');
  } catch {
    metricsInstance = new MemoryMetricsAggregator(instanceId);
    console.warn('[METRICS] Redis no disponible — usando MemoryMetricsAggregator');
  }
  return metricsInstance;
}

function isRedisHealthy(): Promise<boolean> {
  return probeRedis();
}