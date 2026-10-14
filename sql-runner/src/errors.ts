export type ErrorCode =
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

export type RunnerError = {
  code: ErrorCode;
  message: string;
  mysqlErrno?: number;
  retryAfterMs?: number;
};

/** Errors caused by the learner's SQL: these are expected and safe to show. */
export class UserSqlError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly mysqlErrno?: number,
  ) {
    super(message);
  }
}

type MysqlError = { errno?: number; sqlMessage?: string; code?: string };

export function isMysqlServerError(err: unknown): err is Required<Pick<MysqlError, "errno" | "sqlMessage">> {
  const e = err as MysqlError | null;
  return typeof e?.errno === "number" && typeof e.sqlMessage === "string";
}

/**
 * Removes infrastructure details from a MySQL error message: the temporary
 * database name, the ephemeral user and the host it connected from.
 */
export function sanitizeMysqlMessage(message: string): string {
  return message
    .replace(/'qq_u_[A-Za-z0-9_]+'@'[^']*'/g, "'learner'")
    .replace(/qq_u_[A-Za-z0-9_]+/g, "learner")
    .replace(/`?qq_tmp_[A-Za-z0-9_]+`?\./g, "")
    .replace(/`?qq_tmp_[A-Za-z0-9_]+`?/g, "your database")
    .replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, "[host]");
}
