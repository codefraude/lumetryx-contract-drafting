import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(
        import.meta.dirname,
        "tests/server-only-stub.ts",
      ),
    },
  },
  // Integration files share one test database whose
  // schema they reset, so files run one after another.
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    fileParallelism: false,
  },
});
