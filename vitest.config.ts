import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url))
    }
  },
  test: {
    environment: "node",
    globals: true,
    // Keep per-order timing lines out of test output; the timing test
    // re-enables them explicitly.
    env: { ORDER_TIMING_LOGS: "off" }
  }
});
