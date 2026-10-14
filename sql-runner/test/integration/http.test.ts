import type mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { DB_PREFIX, Executor, USER_PREFIX, newExecutionId } from "../../src/execute.js";
import { startRunner, type RunningRunner } from "../../src/runner.js";
import { SHOP_SETUP, leftovers, rootConnection, testConfig } from "./helpers.js";

const config = testConfig({ RATE_LIMIT_PER_MINUTE: "3" });
const headers = { "x-runner-secret": config.RUNNER_SECRET };
const body = (sql: string, clientKey = "user:http-test") => ({
  clientKey,
  setupSql: SHOP_SETUP,
  sql,
  allowedStatement: "select",
});

let root: mysql.Connection;
beforeAll(async () => {
  root = await rootConnection();
});
afterAll(async () => {
  await root.end();
});

describe("HTTP API", () => {
  const executor = new Executor(config);
  const app = buildApp(config, executor);
  afterAll(async () => {
    await app.close();
    await executor.close();
  });

  it("GET /health reports MySQL status without a secret", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", mysql: "ok" });
  });

  it("rejects requests without the shared secret", async () => {
    const res = await app.inject({ method: "POST", url: "/execute", payload: body("SELECT 1") });
    expect(res.statusCode).toBe(401);
    const wrong = await app.inject({
      method: "POST",
      url: "/execute",
      headers: { "x-runner-secret": "nope" },
      payload: body("SELECT 1"),
    });
    expect(wrong.statusCode).toBe(401);
  });

  it("validates the request body", async () => {
    const res = await app.inject({ method: "POST", url: "/execute", headers, payload: { sql: "SELECT 1" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_REQUEST");
  });

  it("enforces the max SQL length", async () => {
    const sql = `SELECT '${"x".repeat(config.MAX_SQL_LENGTH)}'`;
    const res = await app.inject({ method: "POST", url: "/execute", headers, payload: body(sql, "user:long") });
    expect(res.json()).toMatchObject({ ok: false, error: { code: "SQL_TOO_LONG" } });
  });

  it("executes a query and returns the documented shape", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/execute",
      headers,
      payload: body("SELECT name FROM products WHERE price > 30 ORDER BY name", "user:shape"),
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json).toMatchObject({
      ok: true,
      statementType: "SELECT",
      result: { columns: ["name"], rows: [["Keyboard"], ["SQL Book"]], rowCount: 2, truncated: false },
    });
    expect(typeof json.durationMs).toBe("number");
  });

  it("rate limits per client key, independently for each client", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await app.inject({ method: "POST", url: "/execute", headers, payload: body("SELECT 1", "user:spammer") });
      statuses.push(res.statusCode);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);

    const limited = await app.inject({ method: "POST", url: "/execute", headers, payload: body("SELECT 1", "user:spammer") });
    expect(limited.json()).toMatchObject({ ok: false, error: { code: "RATE_LIMITED" } });
    expect(limited.json().error.retryAfterMs).toBeGreaterThan(0);

    const other = await app.inject({ method: "POST", url: "/execute", headers, payload: body("SELECT 1", "user:polite") });
    expect(other.statusCode).toBe(200);
  });

  it("rate limits per client IP across client keys", async () => {
    const ipConfig = testConfig({ IP_RATE_LIMIT_PER_MINUTE: "2" });
    const ipExecutor = new Executor(ipConfig);
    const ipApp = buildApp(ipConfig, ipExecutor);
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 3; i++) {
        const res = await ipApp.inject({
          method: "POST",
          url: "/execute",
          headers,
          payload: { ...body("SELECT 1", `user:ip-${i}`), clientIp: "203.0.113.7" },
        });
        statuses.push(res.statusCode);
      }
      expect(statuses).toEqual([200, 200, 429]);
    } finally {
      await ipApp.close();
      await ipExecutor.close();
    }
  });

  it("rejects multiple statements over HTTP", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/execute",
      headers,
      payload: body("SELECT 1; DROP TABLE products", "user:multi"),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: false, error: { code: "MULTIPLE_STATEMENTS" } });
  });

  it("caps results at 200 rows over HTTP", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/execute",
      headers,
      payload: body("WITH RECURSIVE n (i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 500) SELECT i FROM n", "user:rows"),
    });
    const json = res.json();
    expect(json.result.rows).toHaveLength(200);
    expect(json.result.truncated).toBe(true);
  });

  it("returns errors without secrets, hosts, temp names or stack traces", async () => {
    const sqls = ["SELECT * FROM mysql.user", "SELECT * FROM missing_table", "SELEC 1", "SELECT SLEEP(5)"];
    for (const [i, sql] of sqls.entries()) {
      const res = await app.inject({
        method: "POST",
        url: "/execute",
        headers,
        payload: { ...body(sql, `user:err-${i}`), timeoutMs: 500 },
      });
      const text = res.body;
      expect(res.json().ok).toBe(false);
      for (const secret of [config.RUNNER_ADMIN_PASSWORD, config.RUNNER_SECRET, config.RUNNER_ADMIN_USER, "qq_tmp_", "qq_u_", "127.0.0.1", "    at "]) {
        expect(text).not.toContain(secret);
      }
    }
  });

  it("hides internal errors (e.g. MySQL unreachable) behind a generic message", async () => {
    const broken = testConfig({ RUNNER_ADMIN_PASSWORD: "wrong-password-xyz" });
    const brokenExecutor = new Executor(broken);
    const brokenApp = buildApp(broken, brokenExecutor);
    try {
      const res = await brokenApp.inject({ method: "POST", url: "/execute", headers, payload: body("SELECT 1") });
      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ ok: false, error: { code: "INTERNAL", message: "The SQL runner hit an internal error." } });
      expect(res.body).not.toContain("wrong-password-xyz");
    } finally {
      await brokenApp.close();
      await brokenExecutor.close();
    }
  });
});

describe("startup", () => {
  let runner: RunningRunner | undefined;
  afterAll(async () => {
    await runner?.stop();
  });

  it("sweeps orphaned temp databases and users before accepting requests", async () => {
    const orphan = newExecutionId(Date.now() - 60 * 60_000);
    await root.query(`CREATE DATABASE \`${DB_PREFIX + orphan}\`; CREATE USER '${USER_PREFIX + orphan}'@'%' IDENTIFIED BY 'x'`);
    expect((await leftovers(root)).databases).toContain(DB_PREFIX + orphan);

    runner = await startRunner(testConfig({ PORT: "0" }));

    expect(await leftovers(root)).toEqual({ databases: [], users: [] });
    const res = await runner.app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
  });
});
