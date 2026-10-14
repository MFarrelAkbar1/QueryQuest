/** Token bucket per key: `perMinute` tokens, refilled evenly over a minute. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; updatedAt: number }>();

  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns 0 when allowed, otherwise the number of ms to wait. */
  take(key: string): number {
    const now = this.now();
    const refillPerMs = this.perMinute / 60_000;
    const bucket = this.buckets.get(key) ?? { tokens: this.perMinute, updatedAt: now };
    bucket.tokens = Math.min(this.perMinute, bucket.tokens + (now - bucket.updatedAt) * refillPerMs);
    bucket.updatedAt = now;
    this.buckets.set(key, bucket);

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return 0;
    }
    return Math.ceil((1 - bucket.tokens) / refillPerMs);
  }

  /** Drops buckets that are full again so the map does not grow forever. */
  prune(): void {
    const now = this.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.tokens + (now - bucket.updatedAt) * (this.perMinute / 60_000) >= this.perMinute) {
        this.buckets.delete(key);
      }
    }
  }
}

export class BusyError extends Error {}

/** Limits concurrent executions; a bounded queue absorbs short bursts. */
export class Semaphore {
  private running = 0;
  private waiting: Array<() => void> = [];

  constructor(
    private readonly maxConcurrent: number,
    private readonly maxQueue: number,
  ) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= this.maxConcurrent) {
      if (this.waiting.length >= this.maxQueue) throw new BusyError("Runner is busy");
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.running++;
    }
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      // Hand the slot directly to the next waiter; otherwise release it.
      if (next) next();
      else this.running--;
    }
  }
}
