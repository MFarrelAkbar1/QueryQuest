# QueryQuest — Gamified MySQL Practice App (v1 Spec)

You are a senior full-stack engineer. Build a functional web app where users learn MySQL by solving level-based SQL challenges, with real query execution, automatic validation, XP, and persistent progress.

This is a spec for **v1**. Stay inside the scope below. Do not build anything listed under "Out of scope".

## Working rules

- Work **one phase at a time**. At the end of each phase: run lint, type-check, and tests, fix failures, summarize what you did in under 15 lines, then **STOP and wait for my confirmation** before starting the next phase.
- Inspect the repo before changing anything. Never overwrite existing work without reading it first.
- Keep the app runnable after every phase. Prefer simple, readable code over abstractions.
- No mock data in core workflows. Seed data for exercises is fine.
- If something is genuinely blocking, ask one focused question. Otherwise pick a sensible default and say which one you picked.
- Do not claim SQL execution works unless you actually ran a query through the real execution service.

## Stack (fixed)

- Next.js (App Router), TypeScript strict, Tailwind CSS, shadcn/ui, lucide-react
- Monaco Editor (SQL mode)
- Supabase (Postgres + Auth) for users, progress, XP, achievements. **Only** app data, never user SQL.
- Zod for all request validation
- Vitest for unit tests
- Frontend (Next.js app and its route handlers) deploys to **Vercel**.
- SQL runner + MySQL 8.0 deploy to **Railway** (decided). Do not design for any other host, but keep the runner containerized (Dockerfile) so it stays portable.

Check the repo's existing package manager and dependency versions first and use mutually compatible, stable versions.

## SQL execution architecture (decided)

The product teaches MySQL, so queries must run on **real MySQL 8.0**. Never run user SQL on Postgres.

Vercel cannot host a persistent MySQL server, so build the executor as a **separate small service** in `/sql-runner`:

- Node + TypeScript service (Fastify or Express) using `mysql2`.
- One MySQL 8.0 server (Docker for local dev via `docker-compose.yml`; Railway in production, with the runner and MySQL as two services in one Railway project, connected over Railway's private network).
- Do not use TiDB or any "MySQL-compatible" engine. Do not use a managed MySQL that withholds `CREATE DATABASE` / `CREATE USER` privileges from the runner's admin account.
- The runner needs a `Dockerfile`. MySQL root credentials and the admin/restricted account passwords come from environment variables only.
- **Per-execution isolation:** for each Run/Submit request, create a temporary database (random name), load the challenge's schema + seed, execute the user's SQL in it, return the result, then drop the database. No state leaks between users or runs.
- Two MySQL accounts:
  - an admin account used only by the runner to create/drop temp databases and load seeds;
  - a restricted account used to run user SQL, with privileges only on that single temp database (no GRANT, no FILE, no access to `mysql`/`information_schema` of other schemas, no SUPER).
- Limits: query timeout (use `MAX_EXECUTION_TIME` plus a server-side kill), max 200 result rows returned, max SQL length (e.g. 5,000 chars), max concurrent executions, per-IP/per-user rate limiting.
- Only one statement per request unless a challenge explicitly allows multiple (e.g. transactions in Tier 3+ if added later).
- Each challenge declares an allowed statement type (`SELECT` only, or DML allowed). Enforce this **on the runner**, in addition to the DB-level privileges. Do not rely on keyword blocklists alone.
- Errors returned to the client must be readable MySQL error messages with no stack traces, hostnames, or credentials.
- The Next.js app calls the runner only from server-side route handlers, authenticated with a shared secret header (`RUNNER_SECRET`). The browser never talks to the runner directly.
- The runner must expose `POST /execute` and `GET /health`. Keep the interface small and documented so the service can be swapped later.

## v1 scope

### Content (real exercises, not placeholders)

- **Tier 1 — SQL Beginner:** SELECT, specific columns, WHERE, comparison operators, AND/OR/NOT, ORDER BY, LIMIT, DISTINCT.
- **Tier 2 — SQL Explorer:** INSERT, UPDATE, DELETE, NULL/IS NULL, LIKE, IN, BETWEEN, aliases, COUNT/SUM/AVG/MIN/MAX.
- **Tier 3 — SQL Practitioner:** GROUP BY, HAVING, INNER/LEFT JOIN, multi-table joins, primary/foreign keys.

Tiers 4 and 5 appear on the learning map as **"Coming soon"** (locked, non-interactive). No fake content.

Write roughly 4 chapters per tier and 3–5 challenges per chapter (about 40 challenges total). Content lives in version-controlled files (e.g. `/content/tier-1/chapter-1.ts` or JSON), validated by a Zod schema, so new challenges can be added without touching app code.

Each challenge has: id, title, difficulty, learning objective, short concept explanation, problem statement, schema + seed, expected-result definition, allowed statement type, XP reward, up to 3 progressive hints, reference solution + explanation, starter query.

For DML challenges (INSERT/UPDATE/DELETE), validate by running a **verification SELECT** after the user's statement and comparing that result to the expected one.

### Validation

- Compare **actual result sets**, never keywords.
- Rules per challenge: compare columns (names and order), values, NULLs, row count, and row order **only when the challenge requires ordering** (otherwise compare as multisets).
- Equivalent valid queries must pass.
- Failure feedback is helpful but does not reveal the full solution (e.g. "column names differ", "you returned 4 rows, expected 5").
- Run Query and Submit Answer are distinct: Run only shows results; Submit validates and can award XP.

### Game system

- XP per challenge, bonus XP per chapter, bonus XP per tier. Player level derived from total XP with a progress bar.
- **Idempotent rewards:** each challenge completion awards XP once. Enforce with a unique constraint on `(user_id, challenge_id)` and do the reward in a single server-side transaction. XP, completion, and achievements are **always computed server-side**; never accept them from the client.
- Unlocking: a chapter unlocks when the previous chapter is completed. Completed challenges can be revisited. Locked items show how to unlock them.
- Hint usage is recorded (needed for achievements).
- Achievements (4): First Query, Query Streak (3 challenges in one session), Join Master (finish the JOIN chapter), Error Hunter (fail then pass the same challenge).
- Streak: consecutive days with at least one completion, using the user's timezone stored in their profile (default `Asia/Jakarta`).

### Pages

1. Landing page (value proposition, short feature list, example challenge preview, CTA)
2. Auth: sign up, login, logout, password reset (Supabase Auth)
3. Dashboard (level, XP, progress, streak, recent achievements, Continue Learning button)
4. Learning map (tiers → chapters → challenges, with locked/available/completed states)
5. **SQL workspace** (the most important page): instructions, schema + sample data panel, Monaco editor, Run / Submit buttons, results table, error + feedback panel, hints, solution explanation after completion, previous/next navigation
6. Achievements page (earned and locked, with requirements)
7. Profile (stats, progress overview)

Design: dark navy/charcoal, subtle cyan/violet accents, rounded cards with restrained borders, clean developer-tool feel, responsive (desktop/tablet/mobile), keyboard accessible, loading/empty/error/success states handled everywhere.

### Database (Supabase)

Tables: `profiles`, `player_stats`, `challenge_completions`, `xp_transactions`, `achievements`, `user_achievements`, plus whatever is needed for hint usage and failed attempts. Tier/chapter/challenge definitions come from the content files, not the DB, in v1. Use foreign keys, unique constraints, indexes, timestamps. Enable **Row Level Security** on all user tables: users can read their own rows; writes to XP/completions happen only through server-side code using the service role key, which must never reach the browser. Provide SQL migrations and seed scripts in `/supabase`.

## Testing strategy (three layers)

1. **Unit tests (Vitest, no database):** XP and level calculation, duplicate-completion logic, chapter unlocking, result-set comparison/validation, Zod request validation, content schema validation (every challenge file must parse).
2. **Runner integration tests (real MySQL 8.0):** run against the MySQL container from `docker-compose.yml` (Testcontainers is acceptable if it keeps setup simple). Must cover: successful execution and cleanup of temp databases, timeout enforcement, row-limit enforcement, disallowed statement types rejected, restricted user cannot read other databases or system schemas, concurrent executions do not leak data, error messages contain no secrets. Also run every challenge's **reference solution** through the runner and assert it passes its own validator.
3. **Supabase tests (local only):** use `supabase start` (local Docker) for RLS and idempotent-XP tests: a user cannot read or write another user's rows, a client cannot insert XP or completions directly, submitting the same challenge twice awards XP once. **Never run tests against a production Supabase project.**

Add npm scripts: `test` (unit), `test:runner` (runner integration), `test:db` (Supabase), and `test:all`. Docker is required for layers 2 and 3. Document this in the README.

## Out of scope for v1 (do not build)

- Tiers 4–5 content (subqueries, CTEs, window functions, transactions, EXPLAIN, schema design)
- Guest mode
- Daily quests
- Theme/language settings
- Leaderboards, social features

## Phases

### Phase 1 — Inspect and plan
Inspect the repo. Propose the folder structure, the data model, and the runner API contract. List assumptions. **Do not write feature code.** Stop.

### Phase 2 — SQL runner service
Build `/sql-runner`, its `Dockerfile`, and `docker-compose.yml`. Implement per-execution temp databases, restricted user, limits, rate limiting, statement-type enforcement. Write the layer 2 integration tests against the real MySQL container, including tests proving a user cannot read other databases, cannot exceed the timeout, and cannot run disallowed statements. Stop.

### Phase 3 — App foundation
Next.js setup, Tailwind, shadcn/ui, Supabase migrations with RLS, auth pages, content schema + the first 10 Tier 1 challenges, `.env.example`. Stop.

### Phase 4 — Core learning loop
SQL workspace, Run, Submit, result validation, idempotent XP, completion persistence, unlocking, learning map, dashboard. Unit tests for XP, duplicate prevention, unlocking, and validation. Verify the full flow end to end with the real runner. Stop.

### Phase 5 — Complete v1
Remaining Tier 1–3 challenges, achievements, streak, profile, responsive polish, accessibility pass, "Coming soon" tiers. Stop.

### Phase 6 — Verify and document
Run lint, type-check, all three test layers, and a production build and fix everything. Write `README.md` covering architecture, local setup (Docker + Supabase), environment variables, how to add a challenge, testing, deploying the frontend to Vercel, and deploying the runner + MySQL to Railway step by step (including how Vercel is configured with `RUNNER_URL` and `RUNNER_SECRET`), with an estimate of costs for each external service. List anything that still needs manual configuration. Stop.

## Definition of done (v1)

A signed-in user can: open a beginner challenge, inspect the schema and sample data, write and run a real MySQL query, see actual results, submit and get meaningful feedback, earn XP exactly once, unlock and complete the next challenge, refresh and keep their progress, navigate an accurate learning map, and do all of this on desktop and mobile.