import { describe, expect, it } from "vitest";
import { ORPHAN_SAFETY_FACTOR, loadConfig, worstCaseExecutionMs } from "../../src/config.js";

const required = { RUNNER_SECRET: "x".repeat(32), RUNNER_ADMIN_PASSWORD: "pw" };

describe("execution time budget vs orphan sweep", () => {
  it("keeps the worst-case execution far below the default 2-minute sweep age", () => {
    const config = loadConfig(required);
    const worst = worstCaseExecutionMs(config);
    // 3 admin steps (5s) + setup (5s) + max query (5s) + kill (2s) + 2 cleanup steps (5s)
    expect(worst).toBe(37_000);
    expect(config.ORPHAN_MAX_AGE_MS).toBe(120_000);
    expect(worst * ORPHAN_SAFETY_FACTOR).toBeLessThanOrEqual(config.ORPHAN_MAX_AGE_MS);
  });

  it("refuses to start when the sweep age could catch a running execution", () => {
    expect(() => loadConfig({ ...required, ORPHAN_MAX_AGE_MS: "60000" })).toThrow(/ORPHAN_MAX_AGE_MS: must be at least 111000/);
    expect(() => loadConfig({ ...required, MAX_TIMEOUT_MS: "30000" })).toThrow(/ORPHAN_MAX_AGE_MS/);
  });

  it("rejects a default timeout above the maximum", () => {
    expect(() => loadConfig({ ...required, DEFAULT_TIMEOUT_MS: "9000" })).toThrow(/DEFAULT_TIMEOUT_MS/);
  });

  it("never echoes secret values in configuration errors", () => {
    const secret = "short-secret-value";
    expect(() => loadConfig({ RUNNER_SECRET: secret, RUNNER_ADMIN_PASSWORD: "pw" })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(secret) }),
    );
  });
});
