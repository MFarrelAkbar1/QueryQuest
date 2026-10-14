import { defineConfig } from "vitest/config";
import { alias } from "./vitest.config.ts";

// Layer 2 (part B): reference solutions through the real runner. Needs `docker compose up -d`.
export default defineConfig({
  resolve: { alias },
  test: { environment: "node", include: ["tests/runner/**/*.test.ts"], testTimeout: 30_000, hookTimeout: 30_000 },
});
