import { describe, expect, it } from "vitest";
import { checkStatement } from "../../src/statement.js";

describe("checkStatement", () => {
  it.each([
    ["SELECT * FROM customers", "SELECT"],
    ["  select name from customers;  ", "SELECT"],
    ["(SELECT 1) UNION (SELECT 2)", "SELECT"],
    ["WITH c AS (SELECT 1 AS x) SELECT x FROM c", "SELECT"],
    ["WITH RECURSIVE n (i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 5), m AS (SELECT 2) SELECT * FROM n", "SELECT"],
    ["SELECT 'a;b', \"DROP TABLE x;\", `weird;col` FROM t", "SELECT"],
    ["SELECT 1 -- trailing; DROP TABLE t\n", "SELECT"],
    ["SELECT 1 # comment ; DELETE FROM t", "SELECT"],
    ["/* leading; comment */ SELECT 1", "SELECT"],
    ["SELECT 'it''s', 'back\\'slash;'", "SELECT"],
    ["SELECT 5--1", "SELECT"],
  ])("accepts %s as %s in select mode", (sql, type) => {
    expect(checkStatement(sql, "select")).toEqual({ ok: true, statementType: type });
  });

  it.each([
    ["INSERT INTO t (a) VALUES (1)", "INSERT"],
    ["UPDATE t SET a = 1 WHERE id = 2", "UPDATE"],
    ["DELETE FROM t WHERE id = 1", "DELETE"],
    ["WITH old AS (SELECT id FROM t) DELETE FROM t WHERE id IN (SELECT id FROM old)", "DELETE"],
    ["SELECT * FROM t", "SELECT"],
  ])("accepts %s as %s in dml mode", (sql, type) => {
    expect(checkStatement(sql, "dml")).toEqual({ ok: true, statementType: type });
  });

  it.each([
    "INSERT INTO t VALUES (1)",
    "UPDATE t SET a = 1",
    "DELETE FROM t",
    "WITH x AS (SELECT 1) UPDATE t SET a = 1",
    "DROP TABLE t",
    "CREATE TABLE x (a INT)",
    "SET @a = 1",
    "SHOW DATABASES",
    "CALL p()",
    "DO SLEEP(1)",
    "GRANT ALL ON *.* TO x",
  ])("rejects %s in select mode", (sql) => {
    const result = checkStatement(sql, "select");
    expect(result).toMatchObject({ ok: false, code: "STATEMENT_NOT_ALLOWED" });
  });

  it.each(["DROP TABLE t", "TRUNCATE t", "ALTER TABLE t ADD c INT", "REPLACE INTO t VALUES (1)", "LOAD DATA INFILE 'x' INTO TABLE t", "CREATE USER x"])(
    "rejects %s in dml mode",
    (sql) => {
      expect(checkStatement(sql, "dml")).toMatchObject({ ok: false, code: "STATEMENT_NOT_ALLOWED" });
    },
  );

  it.each([
    "SELECT 1; SELECT 2",
    "SELECT 1; DROP TABLE t",
    "SELECT ';'; DELETE FROM t",
    "SELECT 1;;DELETE FROM t",
  ])("rejects multiple statements: %s", (sql) => {
    expect(checkStatement(sql, "dml")).toMatchObject({ ok: false, code: "MULTIPLE_STATEMENTS" });
  });

  it("rejects file output and SELECT INTO", () => {
    expect(checkStatement("SELECT * FROM t INTO OUTFILE '/tmp/x'", "select")).toMatchObject({ ok: false });
    expect(checkStatement("SELECT * INTO DUMPFILE '/tmp/x' FROM t", "dml")).toMatchObject({ ok: false });
    expect(checkStatement("SELECT a INTO @v FROM t", "select")).toMatchObject({ ok: false });
  });

  it("rejects executable comments and optimizer hints", () => {
    expect(checkStatement("SELECT 1 /*!50000 , SLEEP(10) */", "select")).toMatchObject({
      ok: false,
      code: "STATEMENT_NOT_ALLOWED",
    });
    expect(checkStatement("SELECT /*+ MAX_EXECUTION_TIME(100000) */ 1", "select")).toMatchObject({
      ok: false,
      code: "STATEMENT_NOT_ALLOWED",
    });
  });

  it("reports empty and unterminated input as SQL errors", () => {
    expect(checkStatement("   -- nothing\n ; ", "select")).toMatchObject({ ok: false, code: "SQL_ERROR" });
    expect(checkStatement("SELECT 'oops", "select")).toMatchObject({ ok: false, code: "SQL_ERROR" });
    expect(checkStatement("SELECT 1 /* oops", "select")).toMatchObject({ ok: false, code: "SQL_ERROR" });
  });

  it("does not treat keywords inside strings or identifiers as statements", () => {
    expect(checkStatement("SELECT 'INSERT INTO x' AS `DELETE`", "select")).toEqual({
      ok: true,
      statementType: "SELECT",
    });
  });
});
