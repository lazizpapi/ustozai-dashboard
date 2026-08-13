import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // The real package throws outside a Server Component graph. Keep the
      // production guard, stub it for tests.
      "server-only": fileURLToPath(new URL("./src/test/server-only.stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Live network checks are opt-in via `npm run test:live`, so a flaky Apple
    // feed can never fail an ordinary test run or a deploy.
    exclude: ["**/node_modules/**", "src/**/live.test.ts"],
  },
});
