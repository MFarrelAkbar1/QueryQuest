import { defineConfig } from "vitest/config";
import { alias } from "./vitest.config.ts";

// Layer 3: RLS and idempotent XP against LOCAL Supabase only (`npx supabase start`).
export default defineConfig({
  resolve: { alias },
  test: {
    environment: "node",
    include: ["tests/db/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
