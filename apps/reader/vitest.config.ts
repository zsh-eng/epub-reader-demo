import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        extends: "./vitest.config.server.ts",
        // Include hoisted Wasm dependencies in workerd's module root.
        root: path.resolve(import.meta.dirname, "../.."),
        test: {
          name: "server",
          include: ["apps/reader/test/server/**/*.test.ts"],
        },
      },
      {
        extends: "./vitest.config.client.ts",
        test: {
          name: "client",
          include: ["test/client/**/*.test.ts"],
        },
      },
    ],
  },
});
