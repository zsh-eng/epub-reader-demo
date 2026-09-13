import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "local-sync",
          include: ["packages/local-sync/test/**/*.test.ts"],
          environment: "node",
        },
      },
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
      {
        test: {
          name: "text-highlighter",
          include: ["packages/text-highlighter/test/**/*.test.ts"],
        },
        extends: "./vitest.config.client.ts",
      },
    ],
  },
});
