/** Lock distribuido del scheduler; el adaptador Redis/memoria vive en infraestructura. */
export interface ScheduleLock {
  acquire(key: string, ttlMs: number): Promise<boolean>;
  release(key: string): Promise<void>;
}
