/**
 * Pool de navegador (reutiliza una única instancia de Chromium) y semáforo
 * de concurrencia. Evita lanzar un browser por cada CLICK/SCROLL (picos de
 * CPU/RAM) y acota las acciones browser simultáneas.
 */
import { chromium, type Browser } from 'playwright';

export class Semaphore {
  private available: number;
  private waiters: Array<() => void> = [];

  constructor(permits: number) {
    this.available = Math.max(1, permits);
  }

  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available -= 1;
    } else {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) next();
      else this.available += 1;
    };
  }
}

export class BrowserPool {
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;
  private closed = false;

  private async launch(): Promise<Browser> {
    if (this.closed) throw new Error('BrowserPool cerrado');
    if (this.browser && this.browser.isConnected()) return this.browser;
    if (!this.launching) {
      this.launching = chromium
        .launch({ headless: process.env.CRAWLEE_HEADLESS !== 'false' })
        .then((b) => {
          this.browser = b;
          this.launching = null;
          b.on('disconnected', () => { this.browser = null; });
          return b;
        })
        .catch((e) => {
          this.launching = null;
          throw e;
        });
    }
    return this.launching;
  }

  /** Obtiene el browser compartido (lo lanza si hace falta). */
  acquire(): Promise<Browser> {
    return this.launch();
  }

  async close(): Promise<void> {
    this.closed = true;
    const b = this.browser;
    this.browser = null;
    if (b) await b.close().catch(() => undefined);
  }
}
