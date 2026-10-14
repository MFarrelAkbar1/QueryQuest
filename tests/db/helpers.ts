import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export type Client = SupabaseClient<Database>;

/**
 * Layer 3 talks to the LOCAL Supabase stack only (`npx supabase start`). The URL is
 * checked so these tests can never run against a hosted project.
 */
function localSupabase() {
  const fromEnv = process.env.SUPABASE_TEST_URL;
  let url = fromEnv;
  let publishable = process.env.SUPABASE_TEST_PUBLISHABLE_KEY;
  let secret = process.env.SUPABASE_TEST_SECRET_KEY;
  if (!url || !publishable || !secret) {
    const raw = execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const vars = Object.fromEntries(
      raw
        .split(/\r?\n/)
        .map((line) => line.match(/^([A-Z_]+)="?(.*?)"?$/))
        .filter((m): m is RegExpMatchArray => m !== null)
        .map((m) => [m[1], m[2]]),
    );
    url = vars.API_URL;
    publishable = vars.PUBLISHABLE_KEY ?? vars.ANON_KEY;
    secret = vars.SECRET_KEY ?? vars.SERVICE_ROLE_KEY;
  }
  if (!url || !publishable || !secret) throw new Error("Local Supabase is not running. Run `npx supabase start`.");
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error(`Refusing to run database tests against ${host}: local Supabase only.`);
  }
  return { url, publishable, secret };
}

const env = localSupabase();
const options = { auth: { persistSession: false, autoRefreshToken: false } };

export const admin: Client = createClient<Database>(env.url, env.secret, options);
export const anon: Client = createClient<Database>(env.url, env.publishable, options);

export type TestUser = { id: string; email: string; client: Client };

export async function createUser(metadata: Record<string, string> = {}): Promise<TestUser> {
  const email = `test-${randomUUID()}@example.com`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: "Tester", ...metadata },
  });
  if (error || !data.user) throw error ?? new Error("createUser failed");

  const client = createClient<Database>(env.url, env.publishable, options);
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { id: data.user.id, email, client };
}

export async function deleteUser(user: TestUser | undefined) {
  if (user) await admin.auth.admin.deleteUser(user.id);
}
