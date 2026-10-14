import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export const alias = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
  "@content": fileURLToPath(new URL("./content", import.meta.url)),
  // `server-only` throws outside a React Server Components bundle.
  "server-only": fileURLToPath(new URL("./tests/server-only-stub.ts", import.meta.url)),
};

export default defineConfig({
  resolve: { alias },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
});
