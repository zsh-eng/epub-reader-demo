import { defineConfig } from "@playwright/test";

// Tests the actual native-mode web entry and bridge against the same database
// and Reader helpers as the browser suite. Simulator checks cover UIKit/WKWebView.
export default defineConfig({
  testDir: "./test/e2e",
  testMatch: "mobile.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5192",
    viewport: { width: 390, height: 740 },
    hasTouch: true,
    isMobile: true,
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      "bun run dev --config vite.mobile.config.ts --host 127.0.0.1 --port 5192 --strictPort",
    url: "http://127.0.0.1:5192",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
