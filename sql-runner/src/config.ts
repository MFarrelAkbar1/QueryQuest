import { z } from "zod";

const int = (fallback: number) => z.coerce.number().int().positive().default(fallback);

const BaseSchema = z.object({
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(0).default(4000),
  RUNNER_SECRET: z.string().min(32, "RUNNER_SECRET must be at least 32 characters"),

  MYSQL_HOST: z.string().default("127.0.0.1"),
  MYSQL_PORT: int(3306),
  RUNNER_ADMIN_USER: z.string().default("qq_admin"),
  RUNNER_ADMIN_PASSWORD: z.string().min(1),

  DEFAULT_TIMEOUT_MS: int(3000),
  MAX_TIMEOUT_MS: int(5000),
  /** Per admin statement (CREATE/DROP DATABASE, CREATE/DROP USER, GRANT). */
  ADMIN_QUERY_TIMEOUT_MS: int(5000),
  /** Loading the challenge schema + seed. */
  SETUP_TIMEOUT_MS: int(5000),
  /** Connecting + KILL when a learner session has to be stopped. */
  KILL_TIMEOUT_MS: int(2000),
  MAX_SQL_LENGTH: int(5000),
  MAX_SETUP_SQL_LENGTH: int(200_000),
  MAX_ROWS: int(200),
  MAX_CONCURRENT: int(8),
  MAX_QUEUE: int(16),
  RATE_LIMIT_PER_MINUTE: int(20),
  IP_RATE_LIMIT_PER_MINUTE: int(60),
  ORPHAN_MAX_AGE_MS: int(120_000),
  SWEEP_INTERVAL_MS: int(60_000),
});

const EnvSchema = BaseSchema.superRefine((c, ctx) => {
  if (c.DEFAULT_TIMEOUT_MS > c.MAX_TIMEOUT_MS) {
    ctx.addIssue({ code: "custom", path: ["DEFAULT_TIMEOUT_MS"], message: "must not exceed MAX_TIMEOUT_MS" });
  }
  // The sweeper must never drop the temp database of an execution that is still running.
  const minAge = ORPHAN_SAFETY_FACTOR * worstCaseExecutionMs(c);
  if (c.ORPHAN_MAX_AGE_MS < minAge) {
    ctx.addIssue({
      code: "custom",
      path: ["ORPHAN_MAX_AGE_MS"],
      message: `must be at least ${minAge} ms (${ORPHAN_SAFETY_FACTOR}x the worst-case execution time)`,
    });
  }
});

export type Config = z.infer<typeof EnvSchema>;

/** Admin statements issued before the learner's SQL runs: CREATE DATABASE, CREATE USER, GRANT. */
const ADMIN_STEPS_BEFORE_RUN = 3;
/** Admin statements issued during cleanup: DROP USER, DROP DATABASE. */
const ADMIN_STEPS_CLEANUP = 2;
/** The sweeper's age threshold must exceed the worst-case lifetime by at least this factor. */
export const ORPHAN_SAFETY_FACTOR = 3;

/**
 * Upper bound on how long a temp database can exist for a live execution, from the
 * moment its id is generated until cleanup has finished. Every step is time-boxed.
 */
export function worstCaseExecutionMs(c: Pick<Config, "ADMIN_QUERY_TIMEOUT_MS" | "SETUP_TIMEOUT_MS" | "MAX_TIMEOUT_MS" | "KILL_TIMEOUT_MS">): number {
  return (
    ADMIN_STEPS_BEFORE_RUN * c.ADMIN_QUERY_TIMEOUT_MS +
    c.SETUP_TIMEOUT_MS +
    c.MAX_TIMEOUT_MS +
    c.KILL_TIMEOUT_MS +
    ADMIN_STEPS_CLEANUP * c.ADMIN_QUERY_TIMEOUT_MS
  );
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    // Only report which variables are wrong, never their values.
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid runner configuration:\n  ${problems.join("\n  ")}`);
  }
  return parsed.data;
}
