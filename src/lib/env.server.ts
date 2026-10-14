import "server-only";
import { z } from "zod";

/** Server-only secrets. Importing this from a client component fails the build. */
const ServerEnvSchema = z.object({
  /** Secret key (sb_secret_...) or legacy service_role JWT. Bypasses RLS: server only. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  RUNNER_URL: z.url(),
  RUNNER_SECRET: z.string().min(32),
});

let cached: z.infer<typeof ServerEnvSchema> | undefined;

/** Parsed lazily so `next build` does not need runtime secrets. */
export function serverEnv() {
  cached ??= ServerEnvSchema.parse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    RUNNER_URL: process.env.RUNNER_URL,
    RUNNER_SECRET: process.env.RUNNER_SECRET,
  });
  return cached;
}
