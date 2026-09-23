import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  // Read all migrations in the `migrations` directory
  const migrationsPath = path.join(__dirname, "drizzle");
  const migrations = await readD1Migrations(migrationsPath);
  const arcticMigrations = await readD1Migrations(
    path.join(__dirname, "../../packages/arctic-sync-server/migrations"),
  );

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: path.join(__dirname, "wrangler.jsonc") },
        miniflare: {
          // Add a test-only binding for migrations, so we can apply them in a
          // setup file
          bindings: {
            TEST_MIGRATIONS: migrations,
            TEST_ARCTIC_MIGRATIONS: arcticMigrations,
            // Exercise production cookie attributes while requests stay in workerd.
            BETTER_AUTH_URL: "https://reader.zsheng.app",
            BASE_URL: "https://reader.zsheng.app",
          },
        },
      }),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "@server": path.resolve(__dirname, "./server"),
      },
    },
    test: {
      name: "server",
      setupFiles: [path.join(__dirname, "test/server/apply-migrations.ts")],
    },
  };
});
