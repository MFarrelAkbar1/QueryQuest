import { randomBytes } from "node:crypto";
import mysql, { type Connection, type FieldPacket, type ResultSetHeader } from "mysql2";
import mysqlPromise, { type Pool } from "mysql2/promise";
import { worstCaseExecutionMs, type Config } from "./config.js";
import { UserSqlError, isMysqlServerError, sanitizeMysqlMessage } from "./errors.js";
import { checkStatement, type AllowedStatement, type StatementType } from "./statement.js";

/** Every temporary database / user starts with one of these reserved prefixes. */
export const DB_PREFIX = "qq_tmp_";
export const USER_PREFIX = "qq_u_";
const ID_PATTERN = /^[a-z0-9]+_[a-f0-9]+$/;

const ER_QUERY_TIMEOUT = 3024; // max_execution_time exceeded
const ER_QUERY_INTERRUPTED = 1317;

export type ExecuteInput = {
  setupSql: string;
  sql: string;
  allowedStatement: AllowedStatement;
  verificationSql?: string;
  timeoutMs: number;
};

export type ResultSet = {
  columns: string[];
  rows: (string | null)[][];
  rowCount: number;
  truncated: boolean;
};

export type ExecuteOutput = {
  statementType: StatementType;
  result?: ResultSet;
  affectedRows?: number;
  verification?: ResultSet;
  durationMs: number;
};

/** `<base36 ms timestamp>_<random hex>`; the timestamp lets the sweeper judge age. */
export function newExecutionId(now = Date.now()): string {
  return `${now.toString(36)}_${randomBytes(5).toString("hex")}`;
}

export function executionIdAgeMs(id: string, now = Date.now()): number | undefined {
  if (!ID_PATTERN.test(id)) return undefined;
  const createdAt = parseInt(id.split("_")[0]!, 36);
  return Number.isFinite(createdAt) ? now - createdAt : undefined;
}

function assertSafeId(id: string): string {
  // Names are interpolated into DDL, so they must be exactly what we generate.
  if (!ID_PATTERN.test(id)) throw new Error("Invalid execution id");
  return id;
}

export class Executor {
  readonly admin: Pool;

  constructor(private readonly config: Config) {
    this.admin = mysqlPromise.createPool({
      host: config.MYSQL_HOST,
      port: config.MYSQL_PORT,
      user: config.RUNNER_ADMIN_USER,
      password: config.RUNNER_ADMIN_PASSWORD,
      // Only trusted, content-generated setup SQL is ever sent on admin connections.
      multipleStatements: true,
      connectionLimit: config.MAX_CONCURRENT + 2,
      connectTimeout: config.ADMIN_QUERY_TIMEOUT_MS,
    });
  }

  async ping(): Promise<void> {
    await this.admin.query({ sql: "SELECT 1", timeout: 3_000 });
  }

  async close(): Promise<void> {
    await this.admin.end();
  }

  async execute(input: ExecuteInput): Promise<ExecuteOutput> {
    const check = checkStatement(input.sql, input.allowedStatement);
    if (!check.ok) throw new UserSqlError(check.code, check.message);

    const started = Date.now();
    const id = assertSafeId(newExecutionId());
    const database = DB_PREFIX + id;
    const user = USER_PREFIX + id;
    const password = randomBytes(24).toString("base64url");

    // Hard budget for everything before the learner's SQL runs. No step starts after it
    // and each step is raced against it, so a temp database is never live longer than
    // worstCaseExecutionMs(config), which the config forces well below the sweeper's
    // ORPHAN_MAX_AGE_MS.
    const c = this.config;
    const preRunDeadline = started + 3 * c.ADMIN_QUERY_TIMEOUT_MS + c.SETUP_TIMEOUT_MS;
    const step = <T>(promise: () => Promise<T>) => {
      const remaining = preRunDeadline - Date.now();
      if (remaining <= 0) return Promise.reject(new PreRunTimeout());
      return withTimeout(promise(), remaining, () => new PreRunTimeout());
    };

    let preRunTimedOut = false;
    try {
      await step(() => this.adminQuery(`CREATE DATABASE \`${database}\``));
      await step(() => this.runSetup(database, input.setupSql));

      await step(() =>
        this.adminQuery("CREATE USER ?@'%' IDENTIFIED BY ? WITH MAX_USER_CONNECTIONS 2", [user, password]),
      );
      const privileges = input.allowedStatement === "select" ? "SELECT" : "SELECT, INSERT, UPDATE, DELETE";
      // `_` is a wildcard in GRANT database names; escape it so the grant covers exactly
      // this database (and stays within the admin's own `qq\_tmp\_%` grant).
      const exactDatabase = database.replaceAll("_", "\\_");
      await step(() => this.adminQuery(`GRANT ${privileges} ON \`${exactDatabase}\`.* TO ?@'%'`, [user]));

      const output = await this.runAsLearner({ ...input, database, user, password });
      return { statementType: check.statementType, ...output, durationMs: Date.now() - started };
    } catch (err) {
      if (err instanceof PreRunTimeout) preRunTimedOut = true;
      throw err;
    } finally {
      await this.cleanup(id, { keepDatabase: preRunTimedOut });
    }
  }

  /**
   * Drops the user first, then the database. The database is kept on purpose when
   * dropping the user fails, or when a timed-out admin statement (e.g. CREATE USER)
   * may still land after us: the sweeper finds orphans by database name and drops both.
   */
  private async cleanup(id: string, { keepDatabase }: { keepDatabase: boolean }): Promise<void> {
    const timeout = this.config.ADMIN_QUERY_TIMEOUT_MS;
    try {
      await withTimeout(this.adminQuery("DROP USER IF EXISTS ?@'%'", [USER_PREFIX + id]), timeout);
      if (keepDatabase) return;
      await withTimeout(this.adminQuery(`DROP DATABASE IF EXISTS \`${DB_PREFIX + id}\``), timeout);
    } catch (err) {
      console.error(`[runner] cleanup failed for ${id}; the sweeper will retry`, errorSummary(err));
    }
  }

  /** The longest a live execution can keep its temp database. */
  get worstCaseExecutionMs(): number {
    return worstCaseExecutionMs(this.config);
  }

  /** Drops temporary databases (and their users) older than `maxAgeMs`. */
  async sweepOrphans(maxAgeMs: number, now = Date.now()): Promise<string[]> {
    const [rows] = await this.admin.query<mysqlPromise.RowDataPacket[]>({
      sql: "SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE ?",
      values: [DB_PREFIX.replaceAll("_", "\\_") + "%"],
      timeout: this.config.ADMIN_QUERY_TIMEOUT_MS,
    });

    const swept: string[] = [];
    for (const { name } of rows as { name: string }[]) {
      const id = name.slice(DB_PREFIX.length);
      if (!ID_PATTERN.test(id)) {
        console.warn(`[runner] skipping unexpected database with reserved prefix: ${name}`);
        continue;
      }
      const age = executionIdAgeMs(id, now);
      if (age !== undefined && age < maxAgeMs) continue; // may still be running
      try {
        await this.adminQuery("DROP USER IF EXISTS ?@'%'", [USER_PREFIX + id]);
        await this.adminQuery(`DROP DATABASE IF EXISTS \`${name}\``);
        swept.push(id);
      } catch (err) {
        console.error(`[runner] failed to sweep ${id}`, errorSummary(err));
      }
    }
    return swept;
  }

  private async adminQuery(sql: string, values: unknown[] = []): Promise<void> {
    await this.admin.query({ sql, values, timeout: this.config.ADMIN_QUERY_TIMEOUT_MS });
  }

  private async runSetup(database: string, setupSql: string): Promise<void> {
    const conn = await this.admin.getConnection();
    try {
      await conn.query({ sql: `USE \`${database}\``, timeout: this.config.ADMIN_QUERY_TIMEOUT_MS });
      if (setupSql.trim()) await conn.query({ sql: setupSql, timeout: this.config.SETUP_TIMEOUT_MS });
      conn.release();
    } catch (err) {
      // After a client-side timeout the connection is unusable: take it out of the pool.
      // The server keeps running the statement, which blocks DROP USER/DATABASE, so kill
      // it too (a user may kill its own threads; no extra privilege needed).
      const threadId = conn.threadId;
      conn.destroy();
      if ((err as { code?: string }).code === "PROTOCOL_SEQUENCE_TIMEOUT") {
        await this.adminQuery(`KILL CONNECTION ${Number(threadId)}`).catch(() => {});
      }
      // A broken challenge setup is a content bug, not the learner's fault.
      throw new Error(`Challenge setup failed: ${errorSummary(err)}`, { cause: err });
    }
  }

  private async runAsLearner(
    input: ExecuteInput & { database: string; user: string; password: string },
  ): Promise<Omit<ExecuteOutput, "statementType" | "durationMs">> {
    const credentials = {
      host: this.config.MYSQL_HOST,
      port: this.config.MYSQL_PORT,
      user: input.user,
      password: input.password,
      database: input.database,
    };
    const conn = mysql.createConnection({
      ...credentials,
      multipleStatements: false,
      rowsAsArray: true,
      // Return every value as MySQL's own text representation so nothing is lost
      // to JS number/date conversion. NULL stays null.
      typeCast: (field) => field.string(),
      connectTimeout: 10_000,
    });
    // Killed sessions emit a connection-level error; it is handled via the query/deadline.
    conn.on("error", () => {});

    let timedOut = false;
    let needsKill = false;
    let kill: Promise<void> | undefined;
    // Every learner-side step races this deadline: once a session is killed, mysql2
    // does not always report an error for the in-flight query.
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        kill = killConnection(credentials, conn, this.config.KILL_TIMEOUT_MS).finally(() => conn.destroy());
        reject(timeoutError(input.timeoutMs));
      }, input.timeoutMs);
    });
    deadline.catch(() => {});
    const step = <T>(promise: Promise<T>) => Promise.race([promise, deadline]);

    try {
      // mysql2 connects on creation; connection errors surface on the first query.
      // Server-side backstop in case the client-side kill fails. Slightly longer so
      // our own timer normally wins and reports TIMEOUT consistently.
      const sessionSettings = [
        `SET SESSION max_execution_time = ${input.timeoutMs + 1000}`,
        "SET SESSION innodb_lock_wait_timeout = 2",
      ];
      if (input.allowedStatement === "select") sessionSettings.push("SET SESSION TRANSACTION READ ONLY");
      for (const sql of sessionSettings) await step(streamQuery(conn, sql, 0));

      const main = await step(streamQuery(conn, input.sql, this.config.MAX_ROWS));
      if (main.truncated) needsKill = true;

      // Always run the verification query when given, even after a SELECT: a DML
      // challenge is judged on the data it leaves behind, not on what was printed.
      let verification: ResultSet | undefined;
      if (input.verificationSql && !main.truncated) {
        const v = await step(streamQuery(conn, input.verificationSql, this.config.MAX_ROWS));
        if (v.truncated) needsKill = true;
        verification = v.resultSet;
      }

      return {
        ...(main.resultSet ? { result: main.resultSet } : { affectedRows: main.affectedRows ?? 0 }),
        ...(verification ? { verification } : {}),
      };
    } catch (err) {
      if (timedOut || (isMysqlServerError(err) && [ER_QUERY_TIMEOUT, ER_QUERY_INTERRUPTED].includes(err.errno))) {
        throw timeoutError(input.timeoutMs);
      }
      if (err instanceof UserSqlError) throw err;
      if (isMysqlServerError(err)) {
        throw new UserSqlError("SQL_ERROR", sanitizeMysqlMessage(err.sqlMessage), err.errno);
      }
      throw err;
    } finally {
      clearTimeout(timer);
      // The temp database can only be dropped once the learner's session is gone.
      if (kill) await kill;
      else if (needsKill) await killConnection(credentials, conn, this.config.KILL_TIMEOUT_MS);
      conn.destroy();
    }
  }
}

class PreRunTimeout extends Error {
  constructor() {
    super("Execution setup exceeded its time budget");
  }
}

/** Rejects if `promise` has not settled after `ms`. Does not cancel the underlying work. */
function withTimeout<T>(promise: Promise<T>, ms: number, error = () => new Error(`Timed out after ${ms} ms`)): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(error()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function timeoutError(timeoutMs: number): UserSqlError {
  return new UserSqlError(
    "TIMEOUT",
    `Your query took longer than ${timeoutMs / 1000} seconds and was stopped. Check for missing join conditions or very large results.`,
  );
}

/**
 * Kills the learner's session from a second connection as the same user (MySQL lets
 * a user kill its own threads), so the admin account needs no CONNECTION_ADMIN.
 */
async function killConnection(
  credentials: { host: string; port: number; user: string; password: string },
  target: Connection,
  budgetMs: number,
): Promise<void> {
  const threadId = target.threadId;
  if (!threadId) return;
  try {
    await withTimeout(
      (async () => {
        const killer = await mysqlPromise.createConnection({ ...credentials, connectTimeout: budgetMs });
        try {
          await killer.query({ sql: `KILL CONNECTION ${Number(threadId)}`, timeout: budgetMs });
        } finally {
          killer.destroy();
        }
      })(),
      budgetMs,
    );
  } catch {
    // Already gone, or unreachable: the server-side max_execution_time is the backstop.
  }
}

/**
 * Runs one statement and collects at most `maxRows` rows. When more rows arrive the
 * connection is paused and the result marked truncated; the caller then kills the
 * session instead of buffering an unbounded result in memory.
 */
function streamQuery(
  conn: Connection,
  sql: string,
  maxRows: number,
): Promise<{ resultSet?: ResultSet; affectedRows?: number; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    let columns: string[] | undefined;
    const rows: (string | null)[][] = [];
    let affectedRows: number | undefined;
    let settled = false;

    const query = conn.query(sql);
    // Also emitted (with undefined) for statements without a result set.
    query.on("fields", (fields: FieldPacket[] | undefined) => {
      if (fields) columns = fields.map((f) => f.name);
    });
    query.on("result", (row: unknown) => {
      if (settled) return;
      if (!Array.isArray(row)) {
        affectedRows = (row as ResultSetHeader).affectedRows;
        return;
      }
      if (rows.length < maxRows) {
        rows.push(row as (string | null)[]);
        return;
      }
      settled = true;
      conn.pause();
      resolve({ resultSet: { columns: columns ?? [], rows, rowCount: rows.length, truncated: true }, truncated: true });
    });
    query.on("error", (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    query.on("end", () => {
      if (settled) return;
      settled = true;
      resolve({
        resultSet: columns ? { columns, rows, rowCount: rows.length, truncated: false } : undefined,
        affectedRows,
        truncated: false,
      });
    });
  });
}

export function errorSummary(err: unknown): string {
  if (isMysqlServerError(err)) return `MySQL ${err.errno}: ${err.sqlMessage}`;
  if (err instanceof Error) return err.message;
  return String(err);
}
