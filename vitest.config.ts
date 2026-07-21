import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["./tests/setup/jsdom-polyfills.ts"],
    // Dummy value so importing @/lib/prisma doesn't throw at module load. The
    // pg Pool is lazy (never connects unless queried) and DB-touching helpers
    // are mocked, so no real database is ever contacted during tests.
    env: {
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@locales": fileURLToPath(new URL("./locales", import.meta.url)),
    },
  },
});
