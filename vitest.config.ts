import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "server",
          include: ["test/server/**/*.test.ts"],
          exclude: ["test/client/**/*.test.ts"],
        },
        extends: "./vitest.config.server.ts",
      },
      {
        test: {
          name: "client",
          include: ["test/client/**/*.test.ts"],
        },
        extends: "./vitest.config.client.ts",
      },
    ],
  },
});
