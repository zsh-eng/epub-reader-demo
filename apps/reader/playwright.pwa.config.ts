import { defineConfig, devices } from "@playwright/test";
// Run after bun run build. This uses the production service worker and no API mocks.
export default defineConfig({
  testDir: "./test/e2e",
  outputDir: "./test-results/pwa",
  testMatch: "reader-pwa.spec.ts",
  timeout: 60_000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:5195",
    serviceWorkers: "allow",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      "python3 -m http.server 5195 --bind 127.0.0.1 --directory dist/client",
    url: "http://127.0.0.1:5195",
    reuseExistingServer: false,
  },
});
