# QueryQuest SQL runner

A small Fastify service that runs learner SQL on **real MySQL 8.0**. Every request gets its own temporary database and its own temporary MySQL user. Both are dropped when the request finishes.

Only the Next.js server talks to it, authenticated by a shared secret. Browsers never call it directly.

## API

### `GET /health`
No auth. `200 {"status":"ok","mysql":"ok"}` or `503 {"status":"degraded","mysql":"unreachable"}`.

### `POST /execute`
Header `x-runner-secret: <RUNNER_SECRET>`. Body:

| Field | Type | Notes |
|---|---|---|
| `clientKey` | string | Rate-limit key, e.g. `user:<uuid>` |
| `clientIp` | string? | Optional second rate-limit key |
| `setupSql` | string | Trusted schema + seed SQL (from content files), may contain several statements |
| `sql` | string | Learner SQL, max `MAX_SQL_LENGTH` chars, exactly one statement |
| `allowedStatement` | `"select"` \| `"dml"` | `dml` allows SELECT/INSERT/UPDATE/DELETE |
| `verificationSql` | string? | Trusted SELECT run after the learner's statement (DML checks) |
| `timeoutMs` | number? | Clamped to `MAX_TIMEOUT_MS` |

Success:
```json
{ "ok": true, "statementType": "SELECT",
  "result": { "columns": ["id"], "rows": [["1"], [null]], "rowCount": 2, "truncated": false },
  "durationMs": 12 }
```
DML returns `affectedRows` instead of `result`. When `verificationSql` is given, `verification` has the same shape as `result`. All non-NULL values come back as MySQL's text representation (`"3.50"`), so there is no JS number/date conversion.

Errors: `{ "ok": false, "error": { "code", "message", "mysqlErrno"?, "retryAfterMs"? } }`

| HTTP | `code` |
|---|---|
| 200 | `SQL_ERROR`, `TIMEOUT`, `STATEMENT_NOT_ALLOWED`, `MULTIPLE_STATEMENTS`, `SQL_TOO_LONG` (learner mistakes) |
| 400 | `INVALID_REQUEST` |
| 401 | `UNAUTHORIZED` |
| 429 | `RATE_LIMITED`, `BUSY` |
| 500 | `INTERNAL` (generic message; details only in server logs) |

## How an execution works

1. **Statement check.** A quote- and comment-aware tokenizer accepts exactly one statement of an allowed type. It rejects `/*! */` executable comments, `/*+ */` optimizer hints, `INTO OUTFILE/DUMPFILE` and `SELECT ... INTO`.
2. **Setup.** The admin account creates `qq_tmp_<id>` and loads `setupSql` into it.
3. **Learner account.** The admin account creates a temporary user `qq_u_<id>` (random password, `MAX_USER_CONNECTIONS 2`). That user gets only `SELECT` (select challenges) or `SELECT, INSERT, UPDATE, DELETE` (dml challenges) on that one database.
4. **Run.** The learner's SQL runs as that temporary user with `multipleStatements: false` and `max_execution_time`. Select challenges also run in a `READ ONLY` session. Results are streamed and capped at `MAX_ROWS`. If the timeout or the row cap is hit, the session is killed from a second connection as the same user.
5. **Cleanup.** A `finally` block drops the user, then the database. At startup, and every `SWEEP_INTERVAL_MS` after that, a sweeper drops `qq_tmp_*` databases (plus their `qq_u_*` users) older than `ORPHAN_MAX_AGE_MS`.

## MySQL accounts

Created by `mysql/init/01-admin.sh` on the MySQL container's first boot:

- `root`: init script only. The runner never uses it.
- `qq_admin` (`RUNNER_ADMIN_PASSWORD`):
  - `CREATE USER ON *.*`. MySQL only offers this as a global privilege. It covers create/drop user only, and root keeps `SYSTEM_USER`, so `qq_admin` cannot touch root.
  - `SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, INDEX, REFERENCES ON \`qq\_tmp\_%\`.* WITH GRANT OPTION`.
  - No `ALL ON *.*`, no global `GRANT OPTION`, no `FILE`/`PROCESS`/`SUPER`/`CONNECTION_ADMIN`. It cannot read `mysql.*` or create databases outside the prefix (both covered by tests).

The MySQL config (`mysql/conf/queryquest.cnf`) disables `local_infile` and file import/export (`secure_file_priv = NULL`).

## Environment

| Variable | Default | |
|---|---|---|
| `RUNNER_SECRET` | (required) | min 32 chars |
| `RUNNER_ADMIN_PASSWORD` | (required) | |
| `RUNNER_ADMIN_USER` | `qq_admin` | |
| `MYSQL_HOST` / `MYSQL_PORT` | `127.0.0.1` / `3306` | |
| `HOST` / `PORT` | `0.0.0.0` / `4000` | use `HOST=::` on Railway's IPv6 private network |
| `DEFAULT_TIMEOUT_MS` / `MAX_TIMEOUT_MS` | 3000 / 5000 | |
| `MAX_SQL_LENGTH` / `MAX_SETUP_SQL_LENGTH` | 5000 / 200000 | |
| `MAX_ROWS` | 200 | |
| `MAX_CONCURRENT` / `MAX_QUEUE` | 8 / 16 | |
| `RATE_LIMIT_PER_MINUTE` / `IP_RATE_LIMIT_PER_MINUTE` | 20 / 60 | |
| `ORPHAN_MAX_AGE_MS` / `SWEEP_INTERVAL_MS` | 120000 / 60000 | |

The MySQL container additionally needs `MYSQL_ROOT_PASSWORD`, `RUNNER_ADMIN_USER` and `RUNNER_ADMIN_PASSWORD`.

## Development

```bash
docker compose up -d mysql          # from the repo root; MySQL on 127.0.0.1:3307
cd sql-runner && npm install
npm test                            # unit tests (no DB)
npm run test:integration            # real MySQL from docker-compose
docker compose up -d --build sql-runner   # runner on 127.0.0.1:4000
```
