import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import react from "@vitejs/plugin-react";
import stylex from "@stylexjs/unplugin";
import { pierreHighlighter } from "./tools/pierre-highlighter.ts";
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/browser/**", "tests/host/**", "tests/integration/**"],
          environment: "node",
          testTimeout: 30000,
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/host/**/*.test.ts", "tests/integration/**/*.test.ts"],
          environment: "node",
          testTimeout: 30000,
        },
      },
      {
        plugins: [pierreHighlighter(), stylex.vite({ useCSSLayers: true }), react()],
        optimizeDeps: {
          exclude: ["@pierre/diffs"],
          include: [
            "lru_map",
            "@base-ui/react/combobox",
            "@base-ui/react/popover",
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
