import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import react from "@vitejs/plugin-react";
import stylex from "@stylexjs/unplugin";
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/browser/**"],
          environment: "node",
          testTimeout: 30000,
        },
      },
      {
        plugins: [stylex.vite({ useCSSLayers: true }), react()],
        optimizeDeps: {
          include: [
            "@base-ui/react/combobox",
            "@base-ui/react/tabs",
            "@base-ui/react/tooltip",
            "@pierre/trees",
          ],
        },
        test: {
          name: "browser",
          include: ["tests/browser/**/*.test.ts", "tests/browser/**/*.test.tsx"],
          browser: {
            enabled: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
            headless: true,
          },
        },
      },
    ],
  },
});
