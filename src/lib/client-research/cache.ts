/**
 * Small server-side cache for the client research routes. It exists to bound cost, not to make things fast:
 *  - results are shared by ticker (or by topic), never by client, so 1,000 clients holding the same stock cost one fetch;
 *  - requests that arrive while a fetch is running share it;
 *  - a failed refresh serves the last good result (up to `staleMs` old) marked stale, so a provider blip does not blank a page;
 *  - an hourly budget caps how many uncached fetches the whole app starts, whoever asks, and a semaphore caps how many run at once.
 * In memory and per server instance (same limitation as access/rate-limit.ts), so the budget is per instance too.
 */

export class BusyError extends Error {
  constructor() {
    super("Research is busy right now. Try again in a few minutes.");
    this.name = "BusyError";
  }
}

export class Semaphore {
  private active = 0;
  private waiters: (() => void)[] = [];
  constructor(private max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiters.shift()?.();
    }
  }
}

/** At most `limit` fetches per rolling `windowMs`. */
export class FetchBudget {
  private stamps: number[] = [];
  constructor(private limit: number, private windowMs = 60 * 60_000) {}
  take(now = Date.now()): boolean {
    this.stamps = this.stamps.filter((t) => t > now - this.windowMs);
    if (this.stamps.length >= this.limit) return false;
    this.stamps.push(now);
    return true;
  }
}

export interface Cached<T> {
  value: T;
  fetchedAt: number;
  stale: boolean;
}

interface Entry<T> {
  value: T;
  at: number;
}

const MAX_ENTRIES = 500;

export class ResearchCache<T> {
  private entries = new Map<string, Entry<T>>();
  private inflight = new Map<string, Promise<Cached<T>>>();
  private failures = new Map<string, { error: unknown; at: number }>();

  constructor(
    private ttlMs: number,
    private staleMs: number,
    private budget: FetchBudget,
    private gate: Semaphore,
    private now: () => number = Date.now,
    /** A failure with nothing older to fall back on is remembered this long, so a down provider is not retried on every request. */
    private failureTtlMs = 2 * 60_000,
  ) {}

  async get(key: string, loader: () => Promise<T>): Promise<Cached<T>> {
    const t = this.now();
    const hit = this.entries.get(key);
    if (hit && t - hit.at < this.ttlMs) return { value: hit.value, fetchedAt: hit.at, stale: false };

    const running = this.inflight.get(key);
    if (running) return running;

    const failed = this.failures.get(key);
    if (failed && t - failed.at < this.failureTtlMs) {
      if (hit && t - hit.at < this.staleMs) return { value: hit.value, fetchedAt: hit.at, stale: true };
      throw failed.error;
    }

    const job = this.refresh(key, loader, hit).finally(() => this.inflight.delete(key));
    this.inflight.set(key, job);
    return job;
  }

  private async refresh(key: string, loader: () => Promise<T>, old: Entry<T> | undefined): Promise<Cached<T>> {
    const usableOld = old && this.now() - old.at < this.staleMs ? old : undefined;
    if (!this.budget.take(this.now())) {
      if (usableOld) return { value: usableOld.value, fetchedAt: usableOld.at, stale: true };
      throw new BusyError();
    }
    try {
      const value = await this.gate.run(loader);
      const at = this.now();
      this.failures.delete(key);
      this.entries.set(key, { value, at });
      if (this.entries.size > MAX_ENTRIES) {
        const oldest = [...this.entries.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (oldest) this.entries.delete(oldest[0]);
      }
      return { value, fetchedAt: at, stale: false };
    } catch (e) {
      this.failures.set(key, { error: e, at: this.now() });
      if (usableOld) return { value: usableOld.value, fetchedAt: usableOld.at, stale: true };
      throw e;
    }
  }
}
