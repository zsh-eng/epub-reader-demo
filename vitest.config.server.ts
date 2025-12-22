import {
  defineWorkersProject,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers/config";
import path from "path";

export default defineWorkersProject(async () => {
  // Read all migrations in the `migrations` directory
  const migrationsPath = path.join(__dirname, "drizzle");
  const migrations = await readD1Migrations(migrationsPath);

  return {
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "@server": path.resolve(__dirname, "./server"),
      },
    },
    test: {
      name: "server",
      setupFiles: ["./test/server/apply-migrations.ts"],
      poolOptions: {
        workers: {
          wrangler: { configPath: "./wrangler.jsonc" },
          miniflare: {
            // Add a test-only binding for migrations, so we can apply them in a
            // setup file
            bindings: { TEST_MIGRATIONS: migrations },
          },
        },
      },
    },
  };
});
