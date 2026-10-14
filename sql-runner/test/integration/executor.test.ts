import type mysql from "mysql2/promise";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { UserSqlError } from "../../src/errors.js";
import { DB_PREFIX, Executor, USER_PREFIX, newExecutionId, type ExecuteInput } from "../../src/execute.js";
import { SHOP_SETUP, leftovers, rootConnection, testConfig } from "./helpers.js";

const config = testConfig();
let executor: Executor;
let root: mysql.Connection;

const run = (input: Partial<ExecuteInput> & { sql: string }) =>
  executor.execute({ setupSql: SHOP_SETUP, allowedStatement: "select", timeoutMs: 3000, ...input });

/** Runs and returns the UserSqlError it must throw. */
async function runError(input: Partial<ExecuteInput> & { sql: string }): Promise<UserSqlError> {
  const err = await run(input).then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(UserSqlError);
  return err as UserSqlError;
}

beforeAll(async () => {
  executor = new Executor(config);
  root = await rootConnection();
  // Start from a clean server even if an earlier run crashed.
  await executor.sweepOrphans(0);
});

afterAll(async () => {
  await executor.close();
  await root.end();
});

// Every execution must clean up after itself, whatever the outcome.
afterEach(async () => {
  expect(await leftovers(root)).toEqual({ databases: [], users: [] });
});

describe("successful execution", () => {
  it("returns columns and rows as MySQL text, with NULLs, from a temp database", async () => {
    const out = await run({ sql: "SELECT name, price, category FROM products ORDER BY id" });
    expect(out.statementType).toBe("SELECT");
    expect(out.result).toEqual({
      columns: ["name", "price", "category"],
      rows: [
        ["Keyboard", "49.90", "Hardware"],
        ["Mouse", "19.50", "Hardware"],
        ["SQL Book", "35.00", null],
      ],
      rowCount: 3,
      truncated: false,
    });
  });

  it("runs DML, returns affected rows and the verification result", async () => {
    const out = await run({
      allowedStatement: "dml",
      sql: "UPDATE products SET price = price + 1 WHERE category = 'Hardware'",
      verificationSql: "SELECT id, price FROM products ORDER BY id",
    });
    expect(out.statementType).toBe("UPDATE");
    expect(out.affectedRows).toBe(2);
    expect(out.verification?.rows).toEqual([
      ["1", "50.90"],
      ["2", "20.50"],
      ["3", "35.00"],
    ]);
  });

  it("starts every execution from the original seed", async () => {
    await run({ allowedStatement: "dml", sql: "DELETE FROM products" });
    const out = await run({ sql: "SELECT COUNT(*) AS n FROM products" });
    expect(out.result?.rows).toEqual([["3"]]);
  });

  it("returns readable MySQL errors and still cleans up", async () => {
    const err = await runError({ sql: "SELECT nme FROM products" });
    expect(err.code).toBe("SQL_ERROR");
    expect(err.mysqlErrno).toBe(1054);
    expect(err.message).toBe("Unknown column 'nme' in 'field list'");
  });

  it("cleans up when the challenge setup itself fails", async () => {
    await expect(run({ setupSql: "CREATE TABLE broken (", sql: "SELECT 1" })).rejects.toThrow(/Challenge setup failed/);
  });

  it("time-boxes the setup SQL and still cleans up", async () => {
    const fast = new Executor(testConfig({ SETUP_TIMEOUT_MS: "1000" }));
    try {
      const started = Date.now();
      await expect(
        fast.execute({ setupSql: "DO SLEEP(10)", sql: "SELECT 1", allowedStatement: "select", timeoutMs: 1000 }),
      ).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(fast.worstCaseExecutionMs);
      expect(Date.now() - started).toBeLessThan(4000);
    } finally {
      await fast.close();
    }
  });
});

describe("statement types", () => {
  it.each(["DROP TABLE products", "UPDATE products SET price = 0", "CREATE TABLE x (a INT)", "TRUNCATE products"])(
    "rejects %s in a SELECT-only challenge",
    async (sql) => {
      const err = await runError({ sql });
      expect(err.code).toBe("STATEMENT_NOT_ALLOWED");
    },
  );

  it.each([
    ["select", "SELECT 1; DELETE FROM products"],
    ["select", "SELECT ';'; SELECT 2"],
    ["dml", "UPDATE products SET price = 0; DELETE FROM products"],
    ["dml", "DELETE FROM products WHERE id = 1;\nDELETE FROM products WHERE id = 2;"],
  ] as const)("rejects multiple statements in %s mode: %s", async (allowedStatement, sql) => {
    const err = await runError({ allowedStatement, sql });
    expect(err.code).toBe("MULTIPLE_STATEMENTS");
  });

  it("grants only SELECT in SELECT-only challenges, inside a read-only session", async () => {
    const out = await run({
      sql: "SELECT PRIVILEGE_TYPE, @@session.transaction_read_only AS ro FROM information_schema.SCHEMA_PRIVILEGES ORDER BY 1",
    });
    expect(out.result?.rows).toEqual([["SELECT", "1"]]);
  });

  it("grants only SELECT/INSERT/UPDATE/DELETE in DML challenges", async () => {
    const out = await run({
      allowedStatement: "dml",
      sql: "SELECT PRIVILEGE_TYPE FROM information_schema.SCHEMA_PRIVILEGES ORDER BY 1",
    });
    expect(out.result?.rows.map((r) => r[0])).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"]);
  });
});

describe("isolation", () => {
  it("cannot read system schemas", async () => {
    for (const sql of ["SELECT * FROM mysql.user", "SELECT * FROM sys.version", "SELECT * FROM performance_schema.threads"]) {
      const err = await runError({ sql });
      expect(err.code).toBe("SQL_ERROR");
      expect(err.message).not.toMatch(/qq_/);
    }
  });

  it("does not see other databases in information_schema", async () => {
    const other = DB_PREFIX + newExecutionId();
    await root.query(`CREATE DATABASE \`${other}\``);
    try {
      const out = await run({ sql: "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA ORDER BY 1" });
      const names = out.result!.rows.map((r) => r[0]);
      // MySQL lists performance_schema to everyone; its tables still need privileges (see above).
      expect(names.filter((n) => !n?.startsWith(DB_PREFIX))).toEqual(["information_schema", "performance_schema"]);
      expect(names.filter((n) => n?.startsWith(DB_PREFIX))).toHaveLength(1);
      expect(names).not.toContain(other);
    } finally {
      await root.query(`DROP DATABASE \`${other}\``);
    }
  });

  it("cannot read another execution's temp database", async () => {
    const other = DB_PREFIX + newExecutionId();
    await root.query(`CREATE DATABASE \`${other}\`; CREATE TABLE \`${other}\`.secret (v TEXT); INSERT INTO \`${other}\`.secret VALUES ('top secret')`);
    try {
      const err = await runError({ sql: `SELECT * FROM \`${other}\`.secret` });
      expect(err.code).toBe("SQL_ERROR");
      expect(err.message).not.toContain(other);
      expect(err.message).not.toContain("top secret");
    } finally {
      await root.query(`DROP DATABASE \`${other}\``);
    }
  });

  it("keeps concurrent SELECT and DML executions apart", async () => {
    const outputs = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        i % 2 === 0
          ? run({ allowedStatement: "dml", sql: "DELETE FROM products", verificationSql: "SELECT COUNT(*) FROM products" })
          : run({ sql: "SELECT COUNT(*) FROM products" }),
      ),
    );
    outputs.forEach((out, i) => {
      if (i % 2 === 0) expect(out.verification?.rows).toEqual([["0"]]);
      else expect(out.result?.rows).toEqual([["3"]]); // never sees another run's DELETE
    });
  });

  it("keeps concurrent executions apart", async () => {
    const markers = Array.from({ length: 10 }, (_, i) => `run-${i}`);
    const outputs = await Promise.all(
      markers.map((marker) =>
        run({
          allowedStatement: "dml",
          sql: `INSERT INTO products VALUES (100, '${marker}', 1.00, NULL)`,
          verificationSql: "SELECT name FROM products WHERE id >= 100",
        }),
      ),
    );
    outputs.forEach((out, i) => expect(out.verification?.rows).toEqual([[markers[i]]]));
  });
});

describe("limits", () => {
  it("stops a long SELECT at the timeout", async () => {
    const started = Date.now();
    const err = await runError({ sql: "SELECT SLEEP(10)", timeoutMs: 1000 });
    expect(err.code).toBe("TIMEOUT");
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("stops long DML at the timeout (max_execution_time does not cover DML)", async () => {
    const started = Date.now();
    const err = await runError({ allowedStatement: "dml", sql: "UPDATE products SET name = SLEEP(10)", timeoutMs: 1000 });
    expect(err.code).toBe("TIMEOUT");
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("returns at most MAX_ROWS rows and flags truncation", async () => {
    const out = await run({
      sql: "WITH RECURSIVE n (i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1000) SELECT i FROM n",
    });
    expect(config.MAX_ROWS).toBe(200);
    expect(out.result?.rows).toHaveLength(200);
    expect(out.result?.rowCount).toBe(200);
    expect(out.result?.truncated).toBe(true);
    expect(out.result?.rows.at(-1)).toEqual(["200"]);
  });

  it("does not flag exactly 200 rows as truncated", async () => {
    const out = await run({
      sql: "WITH RECURSIVE n (i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 200) SELECT i FROM n",
    });
    expect(out.result?.rows).toHaveLength(200);
    expect(out.result?.truncated).toBe(false);
  });
});

describe("orphan sweep", () => {
  it("drops old temp databases and their users, keeps recent ones", async () => {
    const oldId = newExecutionId(Date.now() - 10 * 60_000);
    const freshId = newExecutionId();
    for (const id of [oldId, freshId]) {
      await root.query(`CREATE DATABASE \`${DB_PREFIX + id}\`; CREATE USER '${USER_PREFIX + id}'@'%' IDENTIFIED BY 'x'`);
    }

    const swept = await executor.sweepOrphans(config.ORPHAN_MAX_AGE_MS);
    // A running runner container sweeps the same server, so it may have dropped it first.
    expect(swept.filter((id) => id !== oldId)).toEqual([]);
    const after = await leftovers(root);
    expect(after.databases).toEqual([DB_PREFIX + freshId]);
    expect(after.users).toEqual([USER_PREFIX + freshId]);

    await root.query(`DROP DATABASE \`${DB_PREFIX + freshId}\`; DROP USER '${USER_PREFIX + freshId}'@'%'`);
  });
});

describe("admin account privileges", () => {
  it("has no global data privileges and no global GRANT OPTION", async () => {
    const [grants] = await executor.admin.query<mysql.RowDataPacket[]>("SHOW GRANTS");
    const lines = grants.map((g) => Object.values(g)[0] as string);
    const global = lines.find((l) => l.includes(" ON *.* "))!;
    expect(global).toMatch(/^GRANT CREATE USER ON \*\.\* TO/);
    expect(global).not.toMatch(/GRANT OPTION/);
    expect(lines.filter((l) => l.includes("WITH GRANT OPTION")).every((l) => l.includes("`qq\\_tmp\\_%`.*"))).toBe(true);
  });

  it("cannot read system tables or create databases outside the temp prefix", async () => {
    await expect(executor.admin.query("SELECT * FROM mysql.user")).rejects.toMatchObject({ errno: 1142 });
    await expect(executor.admin.query("CREATE DATABASE not_a_temp_db")).rejects.toMatchObject({ errno: 1044 });
  });
});
