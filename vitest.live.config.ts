import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/** Opt-in config for the live endpoint canary. See src/lib/collectors/live.test.ts. */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/live.test.ts"],
    // Apple rate-limits a burst of RSS requests from one address.
    fileParallelism: false,
  },
});
