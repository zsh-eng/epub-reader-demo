import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  // Read all migrations in the `migrations` directory
  const migrationsPath = path.join(__dirname, "drizzle");
  const localSyncMigrationsPath = path.join(
    __dirname,
    "packages/local-sync/migrations/d1",
  );
  const migrations = await readD1Migrations(migrationsPath);
  const localSyncMigrations = await readD1Migrations(localSyncMigrationsPath);

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          // Add a test-only binding for migrations, so we can apply them in a
          // setup file
          bindings: {
            TEST_MIGRATIONS: [...migrations, ...localSyncMigrations],
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
      setupFiles: ["./test/server/apply-migrations.ts"],
    },
  };
});
