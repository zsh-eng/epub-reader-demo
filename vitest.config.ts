import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";
import path from "path";

export default defineWorkersConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@server": path.resolve(__dirname, "./server"),
    },
  },
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
      },
    },
  },
});
