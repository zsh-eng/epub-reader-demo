import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  testDir: ".",
  testMatch: "sqlite-wasm.playwright.ts",
  use: {
    baseURL: "http://127.0.0.1:4178",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
  ],
  webServer: {
    command: "bunx vite --config test/sqlite-wasm/vite.config.ts",
    cwd: packageRoot,
    url: "http://127.0.0.1:4178",
    reuseExistingServer: false,
  },
});
