import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  testMatch: ["player.spec.ts", "library.spec.ts"],
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4379",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  outputDir: ".local/playwright-results",
  webServer: {
    command: "PORT=4379 bun run dev",
    url: "http://127.0.0.1:4379",
    reuseExistingServer: false,
  },
  reporter: "list",
});
