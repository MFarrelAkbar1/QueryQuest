/**
 * Types and a plain fetch wrapper for the SQL runner's HTTP API (see sql-runner/README.md).
 * No secrets here: callers pass the URL and secret. App code uses ./client.ts, which is
 * server-only and reads them from the environment.
 */

export type AllowedStatement = "select" | "dml";

export type RunnerResultSet = {
  columns: string[];
  rows: (string | null)[][];
  rowCount: number;
  truncated: boolean;
};

export type RunnerErrorCode =
  | "SQL_ERROR"
  | "TIMEOUT"
  | "STATEMENT_NOT_ALLOWED"
  | "MULTIPLE_STATEMENTS"
  | "SQL_TOO_LONG"
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "BUSY"
  | "INTERNAL";

export type RunnerResponse =
  | {
      ok: true;
      statementType: "SELECT" | "INSERT" | "UPDATE" | "DELETE";
      result?: RunnerResultSet;
      affectedRows?: number;
      verification?: RunnerResultSet;
      durationMs: number;
    }
  | {
      ok: false;
      error: { code: RunnerErrorCode; message: string; mysqlErrno?: number; retryAfterMs?: number };
    };

export type ExecuteRequest = {
  clientKey: string;
  clientIp?: string;
  setupSql: string;
  sql: string;
  allowedStatement: AllowedStatement;
  verificationSql?: string;
  timeoutMs?: number;
};

const UNAVAILABLE: RunnerResponse = {
  ok: false,
  error: { code: "INTERNAL", message: "The SQL runner is unavailable right now. Please try again shortly." },
};

export async function callRunner(
  baseUrl: string,
  secret: string,
  request: ExecuteRequest,
  { timeoutMs = 15_000 }: { timeoutMs?: number } = {},
): Promise<RunnerResponse> {
  let res: Response;
  try {
    res = await fetch(new URL("/execute", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json", "x-runner-secret": secret },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch {
    return UNAVAILABLE;
  }
  try {
    const body = (await res.json()) as RunnerResponse;
    if (typeof body?.ok !== "boolean") return UNAVAILABLE;
    return body;
  } catch {
    return UNAVAILABLE;
  }
}
