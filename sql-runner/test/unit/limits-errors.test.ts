import { describe, expect, it } from "vitest";
import { sanitizeMysqlMessage } from "../../src/errors.js";
import { executionIdAgeMs, newExecutionId } from "../../src/execute.js";
import { BusyError, RateLimiter, Semaphore } from "../../src/limits.js";

describe("RateLimiter", () => {
  it("allows up to the per-minute budget, then asks to wait, then refills", () => {
    let now = 0;
    const limiter = new RateLimiter(3, () => now);
    expect([limiter.take("u"), limiter.take("u"), limiter.take("u")]).toEqual([0, 0, 0]);
    const wait = limiter.take("u");
    expect(wait).toBeGreaterThan(0);
    expect(limiter.take("other")).toBe(0);
    now += wait;
    expect(limiter.take("u")).toBe(0);
  });
});

describe("Semaphore", () => {
  it("caps concurrency and rejects when the queue is full", async () => {
    const semaphore = new Semaphore(1, 1);
    let release!: () => void;
    const first = semaphore.run(() => new Promise<void>((r) => (release = r)));
    const second = semaphore.run(async () => "second");
    await expect(semaphore.run(async () => "third")).rejects.toBeInstanceOf(BusyError);
    release();
    await first;
    await expect(second).resolves.toBe("second");
    await expect(semaphore.run(async () => "fourth")).resolves.toBe("fourth");
  });
});

describe("sanitizeMysqlMessage", () => {
  it("removes temp database names, ephemeral users and hosts", () => {
    const raw =
      "SELECT command denied to user 'qq_u_mg1abc_0123456789'@'172.18.0.3' for table 'user'; " +
      "Table 'qq_tmp_mg1abc_0123456789.orders' doesn't exist";
    const clean = sanitizeMysqlMessage(raw);
    expect(clean).toBe("SELECT command denied to user 'learner' for table 'user'; Table 'orders' doesn't exist");
    expect(clean).not.toMatch(/qq_|172\./);
  });
});

describe("execution ids", () => {
  it("encode their creation time and are valid MySQL user names", () => {
    const id = newExecutionId(1_700_000_000_000);
    expect(executionIdAgeMs(id, 1_700_000_005_000)).toBe(5_000);
    expect(`qq_u_${id}`.length).toBeLessThanOrEqual(32);
    expect(executionIdAgeMs("not-an-id")).toBeUndefined();
  });
});
