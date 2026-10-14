import { z } from "zod";

const int = (fallback: number) => z.coerce.number().int().positive().default(fallback);

const EnvSchema = z.object({
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(0).default(4000),
  RUNNER_SECRET: z.string().min(32, "RUNNER_SECRET must be at least 32 characters"),

  MYSQL_HOST: z.string().default("127.0.0.1"),
  MYSQL_PORT: int(3306),
  RUNNER_ADMIN_USER: z.string().default("qq_admin"),
  RUNNER_ADMIN_PASSWORD: z.string().min(1),

  DEFAULT_TIMEOUT_MS: int(3000),
  MAX_TIMEOUT_MS: int(5000),
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

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    // Only report which variables are wrong, never their values.
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid runner configuration:\n  ${problems.join("\n  ")}`);
  }
  return parsed.data;
}
