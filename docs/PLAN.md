# QueryQuest — v1 Plan (Phase 1)

Planning document for `SPEC.md`. No feature code yet.

## 1. Repo inspection

| Item | Finding |
|---|---|
| Git | `main`, one commit (`README.md` only). `SPEC.md` untracked. Remote `MFarrelAkbar1/QueryQuest`. |
| Existing code | None. No `package.json`, no lockfile, no config. |
| `README.md` | UTF-16 encoded, just a title. Will be rewritten as UTF-8 in Phase 6. |
| Tooling on machine | Node 22.13, npm 11.6, Yarn 1.22 (global), Docker 27.3 + Compose v2.29. No pnpm. No Supabase CLI. |

Decisions from this:
- **Package manager: npm** (no existing lockfile; npm ships with Node, and Vercel/Railway support it out of the box).
- **Supabase CLI as a devDependency** (`npx supabase ...`), so nothing needs a global install.
- Dependency versions: latest stable at install time in Phase 2/3 (Next.js App Router + React it ships with, Tailwind + matching shadcn/ui CLI, `@supabase/ssr` + `@supabase/supabase-js`, Zod, Vitest, `mysql2`, Fastify). Pinned via `package-lock.json`. Compatibility checked when installing, not guessed here.

## 2. Folder structure

The Next.js app lives at the repo root. The runner is a **separate npm package** (own `package.json` + lockfile, not an npm workspace) so Railway can build `/sql-runner` with its Dockerfile in isolation.

```
/
├─ SPEC.md, README.md, docs/PLAN.md
├─ package.json                # Next app + root scripts (test, test:runner, test:db, test:all)
├─ docker-compose.yml          # mysql (8.0) + sql-runner for local dev & runner tests
├─ .env.example
├─ vitest.config.ts            # layer 1 (unit, no DB)
├─ vitest.runner.config.ts     # layer 2 part B (reference solutions via real runner)
├─ vitest.db.config.ts         # layer 3 (local Supabase)
│
├─ content/                    # version-controlled exercises (TypeScript, Zod-validated)
│  ├─ schema.ts                # Zod schemas for Dataset / Challenge / Chapter / Tier
│  ├─ datasets/                # shared structured datasets (shop.ts, company.ts, library.ts ...)
│  ├─ tier-1/chapter-1.ts ...  # one file per chapter, 3–5 challenges each
│  ├─ tier-2/..., tier-3/...
│  └─ index.ts                 # assembles tiers (+ "coming soon" tiers 4–5 as metadata only)
│
├─ src/
│  ├─ app/
│  │  ├─ (marketing)/page.tsx                    # landing
│  │  ├─ (auth)/login, signup, forgot-password, update-password
│  │  ├─ auth/callback/route.ts, auth/signout/route.ts
│  │  ├─ (app)/dashboard, learn, learn/[challengeId] (workspace), achievements, profile
│  │  └─ api/challenges/[id]/run | submit | hint | solution  (route handlers)
│  ├─ components/ui/           # shadcn/ui
│  ├─ components/{workspace,map,dashboard,layout}/
│  └─ lib/
│     ├─ env.ts                # Zod-validated env, server-only split
│     ├─ supabase/{client,server,admin}.ts   # admin = service role, `server-only`
│     ├─ runner/client.ts      # typed fetch to RUNNER_URL with RUNNER_SECRET
│     ├─ content/              # loader + dataset → SQL generator + public (hint/solution-stripped) views
│     ├─ validation/compare.ts # pure result-set comparison
│     ├─ game/{xp,levels,unlock}.ts          # pure functions
│     └─ schemas/api.ts        # Zod request bodies
│
├─ sql-runner/
│  ├─ package.json, tsconfig.json, Dockerfile, README.md
│  ├─ src/{server.ts, runner.ts, app.ts, config.ts, execute.ts, statement.ts, limits.ts, errors.ts}
│  ├─ mysql/conf/queryquest.cnf    # local_infile=0, secure_file_priv, etc.
│  ├─ mysql/init/01-admin.sh       # creates admin account from env on first boot
│  └─ test/                        # layer 2 part A (isolation, limits, security)
│
├─ supabase/
│  ├─ config.toml
│  ├─ migrations/0001_init.sql ...
│  ├─ seed.sql                     # achievements catalogue
│  └─ tests/                       # layer 3 (RLS, idempotent XP) – local only
│
└─ tests/
   ├─ unit/                        # xp, levels, unlock, compare, zod, content parse
   └─ runner/reference-solutions.test.ts
```

## 3. Content model (`content/schema.ts`)

Datasets are **structured** (tables, typed columns, rows, FKs) rather than raw SQL. One generator turns them into `CREATE TABLE` + `INSERT` SQL for the runner, and the workspace's schema/sample-data panel renders the same structure — so the panel always matches what the query actually runs against.

```ts
Dataset   { id, tables: Table[] }
Table     { name, columns: { name, type /* MySQL type */, primaryKey?, nullable?, references?: {table, column} }[], rows: (string|number|null)[][] }

Challenge {
  id: string               // "t1-c1-01", stable, used in DB
  title, difficulty: "easy" | "medium" | "hard"
  objective, concept, problem         // markdown
  datasetId: string                   // or inline `dataset` override
  statementType: "select" | "dml"
  starterSql: string
  hints: string[]                     // max 3, progressive
  solution: { sql: string, explanation: string }
  verificationSql?: string            // required when statementType = "dml"
  expected: { columns: string[], rows: (string|null)[][], ordered: boolean }
  xp: number                          // default by difficulty: 10 / 20 / 30
}
Chapter   { id: "t1-c1", title, summary, bonusXp, challenges: Challenge[] }
Tier      { id: "tier-1", title, bonusXp, status: "available" | "coming-soon", chapters: Chapter[] }
```

`expected` is stored explicitly (reviewable in diffs). A test runs every `solution.sql` through the real runner and asserts it passes the validator against `expected`, so the two can never drift. A small script (`npm run content:expected -- <challengeId>`) will print the expected block from the reference solution to make authoring easy.

## 4. Runner API contract (`/sql-runner`)

All requests except `/health` require header `x-runner-secret: <RUNNER_SECRET>` (constant-time compare). JSON in, JSON out.

### `GET /health`
`200 { "status": "ok", "mysql": "ok" }` or `503 { "status": "degraded", "mysql": "unreachable" }`. No secret needed, no details leaked.

### `POST /execute`
Request (Zod-validated):
```jsonc
{
  "clientKey": "user:<uuid>",          // used for rate limiting (Next passes user id)
  "setupSql": "CREATE TABLE ...; INSERT ...;", // trusted, generated from content; run by admin
  "sql": "SELECT name FROM customers",  // user SQL, max 5000 chars
  "allowedStatement": "select",         // "select" | "dml"
  "verificationSql": "SELECT ...",      // optional, trusted, run after user SQL (DML checks)
  "timeoutMs": 3000                     // optional, clamped to server max (default 3000, max 5000)
}
```
Success (`200`):
```jsonc
{
  "ok": true,
  "statementType": "SELECT",            // SELECT | INSERT | UPDATE | DELETE
  "result": {                           // present for SELECT
    "columns": ["name"],
    "rows": [["Alice"], [null]],        // every non-null value as MySQL text representation (string)
    "rowCount": 2,                      // rows actually produced
    "truncated": false                  // true if > 200 rows (only first 200 returned)
  },
  "affectedRows": 3,                    // present for DML
  "verification": { /* same shape as result */ },
  "durationMs": 12
}
```
User-SQL failure (`200`, it's a normal outcome, not a transport error):
```jsonc
{ "ok": false, "error": { "code": "SQL_ERROR", "message": "Unknown column 'nme' in 'field list'", "mysqlErrno": 1054 } }
```
Error codes: `SQL_ERROR`, `TIMEOUT`, `STATEMENT_NOT_ALLOWED`, `MULTIPLE_STATEMENTS`, `SQL_TOO_LONG` (200 with `ok:false`); `INVALID_REQUEST` (400), `UNAUTHORIZED` (401), `RATE_LIMITED` / `BUSY` (429, with `retryAfterMs`), `INTERNAL` (500, generic message, details only in server logs).

Values are returned as strings (`rowsAsArray`, `dateStrings`, `bigNumberStrings`) so nothing is lost to JS float/date conversion; the validator normalises numerics.

### Execution pipeline (per request)
1. Auth, Zod validation, length check, rate limit (token bucket per `clientKey`, in-memory — the runner is a single long-lived process), concurrency semaphore (e.g. 8 running, small queue, else `BUSY`).
2. **Statement check** (runner side): tokenizer that understands quotes, backticks and comments → must be exactly one statement; classify leading keyword (`SELECT`/`WITH ... SELECT`, `INSERT`, `UPDATE`, `DELETE`); reject anything else and reject `INTO OUTFILE/DUMPFILE/@var`, `LOAD`, locking clauses that write. This is one layer, not the only one.
3. Admin connection: `CREATE DATABASE qq_tmp_<ts>_<rand>`, run `setupSql` in it.
4. Create an **ephemeral restricted user** `qq_u_<same id>` with a random password, `MAX_USER_CONNECTIONS 1`, granted only `SELECT` (select challenges) or `SELECT, INSERT, UPDATE, DELETE` (dml challenges) on `qq_tmp_<id>.*`. No GRANT, FILE, PROCESS, SUPER, no other schema.
5. Connect as that user (`multipleStatements: false`), `SET SESSION max_execution_time`, `SET SESSION TRANSACTION READ ONLY` for select challenges, run user SQL with a client-side timer that issues `KILL QUERY` from the admin connection on overrun.
6. For DML: run `verificationSql` (as the restricted user, same DB).
7. `finally`: drop user, drop database. A periodic sweeper also drops any `qq_tmp_*` / `qq_u_*` older than 5 minutes (crash recovery) and runs once on startup.
8. Error mapping: only `message` + `errno` of MySQL errors from the user connection are returned; any temp DB / user name in a message is replaced with a neutral placeholder.

### MySQL accounts (as built in Phase 2)
- `root`: used only by the MySQL init script (env `MYSQL_ROOT_PASSWORD`).
- `qq_admin` (env `RUNNER_ADMIN_PASSWORD`): `CREATE USER ON *.*` (MySQL only offers it as a global privilege) plus `SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, INDEX, REFERENCES` **WITH GRANT OPTION only on `` `qq\_tmp\_%`.* ``**. No `ALL ON *.*`, no global GRANT OPTION, no FILE/PROCESS/SUPER/CONNECTION_ADMIN.
- Learner: ephemeral `qq_u_<id>` per execution, `MAX_USER_CONNECTIONS 2`. Gets `SELECT`, or `SELECT, INSERT, UPDATE, DELETE`, on exactly `qq_tmp_<id>` (underscores escaped in the GRANT). Timeouts and row-cap overruns are killed from a second connection as the same user, so admin needs no CONNECTION_ADMIN.
- Orphan sweep works from database names: drop `qq_u_<id>`, then `qq_tmp_<id>`. Cleanup never drops a database before its user, so every orphan user has an orphan database, and admin never needs to read `mysql.user`.

## 5. Data model (Supabase / Postgres)

Challenge/chapter/tier ids are `text` referencing content files (not FKs, since content isn't in the DB in v1).

| Table | Columns (key ones) | Constraints / indexes |
|---|---|---|
| `profiles` | `id uuid pk → auth.users`, `display_name`, `timezone text default 'Asia/Jakarta'`, `created_at`, `updated_at` | created by trigger on `auth.users` insert |
| `player_stats` | `user_id pk → profiles`, `total_xp int`, `challenges_completed int`, `current_streak int`, `longest_streak int`, `last_completion_date date`, `updated_at` | one row per user, created by same trigger |
| `challenge_completions` | `id`, `user_id`, `challenge_id`, `chapter_id`, `tier_id`, `xp_awarded`, `hints_used`, `completed_at` | **unique (user_id, challenge_id)**, index (user_id, completed_at) |
| `xp_transactions` | `id`, `user_id`, `amount`, `source_type` (`challenge` / `chapter_bonus` / `tier_bonus`), `source_id`, `created_at` | **unique (user_id, source_type, source_id)** → bonuses are idempotent too |
| `achievements` | `id text pk` (`first_query`, `query_streak`, `join_master`, `error_hunter`), `name`, `description`, `requirement`, `sort_order` | seeded |
| `user_achievements` | `user_id`, `achievement_id → achievements`, `earned_at` | pk (user_id, achievement_id) |
| `hint_usages` | `user_id`, `challenge_id`, `hint_index`, `revealed_at` | pk (user_id, challenge_id, hint_index) |
| `challenge_attempts` | `id`, `user_id`, `challenge_id`, `passed bool`, `feedback_code text`, `created_at` | index (user_id, challenge_id, created_at) |

**RLS:** enabled on every table. `authenticated` gets `SELECT` where `user_id = auth.uid()` (or `id = auth.uid()` on profiles) and `UPDATE` on own `profiles` (display_name, timezone only). `achievements` readable by everyone. No `INSERT/UPDATE/DELETE` policies on stats/XP/completions/achievements/attempts/hints → clients cannot write them.

**Award transaction:** Postgres function `award_challenge(p_user_id, p_challenge_id, p_chapter_id, p_tier_id, p_xp, p_chapter_challenge_ids text[], p_chapter_bonus, p_tier_chapter_ids text[], p_tier_bonus, p_join_chapter_id)` — `SECURITY DEFINER`, `EXECUTE` revoked from `anon`/`authenticated`, granted to `service_role` only. In one transaction it:
1. `INSERT ... ON CONFLICT (user_id, challenge_id) DO NOTHING`; if nothing inserted → return `{ alreadyCompleted: true, xp: 0 }`.
2. Inserts the `xp_transactions` row, updates `player_stats` (XP, count, streak using `now() at time zone profiles.timezone`).
3. Awards chapter/tier bonuses if all ids in the passed lists are now completed (ON CONFLICT DO NOTHING).
4. Evaluates the 4 achievements, returns XP gained + new achievements.

The app passes chapter/tier membership because content lives in files; values come from server-side content, never from the request body.

## 6. Game rules (defaults I picked)

- XP: easy 10, medium 20, hard 30; chapter bonus 50; tier bonus 150.
- Level: Level 1 at 0 XP; XP needed to go from level L to L+1 = `100 + 50·(L−1)` (100, 150, 200, …). ~40 challenges + bonuses ≈ level 7–8 at v1 completion.
- Unlocking: tier 1 chapter 1 is open; each next chapter (crossing tier boundaries) unlocks when the previous chapter is fully completed. Inside a chapter, challenges unlock **sequentially** (DoD: "unlock and complete the next challenge"). Enforced server-side on Run/Submit/Hint, not only in UI.
- Hints/solution: served by route handlers, not shipped in the page payload. Revealing a hint records it. Solution + explanation only returned after completion.
- Streak: consecutive calendar days (in profile timezone) with ≥1 new completion.

## 7. Next.js ↔ runner flow

`POST /api/challenges/[id]/run` and `/submit` (Zod body `{ sql }`): require Supabase session → load challenge from content → check unlocked → call runner with `setupSql` / `verificationSql` from content, `clientKey = user:<id>` → Run returns result; Submit additionally compares with `expected`, logs `challenge_attempts`, and on pass calls `award_challenge` with the service-role client. Feedback messages: `COLUMN_COUNT`, `COLUMN_NAMES`, `ROW_COUNT` ("you returned 4 rows, expected 5"), `VALUES`, `ORDER` (only when `ordered`), `NULLS`, `TRUNCATED`.

**Comparison rules:** column names compared case-insensitively and in order; rows compared as multisets unless `ordered`; `NULL` ≠ `'NULL'`/empty; numeric strings normalised as exact decimal text (`"52.5000"`, `"52.50"` and `52.5` all become `"52.5"`; no float rounding, no tolerance); everything else exact string compare.

## 8. Assumptions (please correct any)

- **A1** npm, Node 22 LTS for both app and runner (`engines` + Docker `node:22-alpine`).
- **A2** Runner framework: **Fastify** (built-in schema/hooks, light).
- **A3** "Restricted account" is implemented as an **ephemeral MySQL user per execution**, scoped to that execution's temp DB. A single shared restricted user would be able to see other users' concurrent temp DBs, which violates isolation.
- **A4** Login is required for Run/Submit (no guest mode). The landing-page challenge preview is static.
- **A5** "Query Streak — 3 challenges in one session" = 3 new completions where each comes ≤ 30 minutes after the previous one.
- **A6** "Join Master" = completing the Tier 3 chapter dedicated to JOINs (id fixed in content).
- **A7** "Error Hunter" = a failed submission followed by a passing submission of the same challenge (resubmitting an already completed challenge doesn't count again — achievement awarded once anyway).
- **A8** Rate limit default: 20 executions / minute / user, 8 concurrent executions per runner instance; all configurable by env.
- **A9** Local Supabase via `npx supabase start` (needs Docker). Production Supabase project and Railway/Vercel accounts are created manually by you; I won't touch any hosted project.
- **A10** UI language: English (matches the spec). Tell me if you want Bahasa Indonesia.
- **A11** Each chapter uses one shared dataset (e.g. a small shop/company/library DB) so learners get familiar with it; challenges can override.
