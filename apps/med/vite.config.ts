import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import stylex from "@stylexjs/unplugin";
import { pierreHighlighter } from "./tools/pierre-highlighter.ts";

export default defineConfig({
  plugins: [pierreHighlighter(), stylex.vite({ useCSSLayers: true }), react()],
  optimizeDeps: {
    exclude: ["@pierre/diffs"],
    include: [
      "lru_map",
      "@base-ui/react/combobox",
      "@base-ui/react/popover",
      "@base-ui/react/tabs",
      "@pierre/trees",
    ],
  },
  worker: { format: "es", plugins: () => [pierreHighlighter()] },
  build: { outDir: "dist/web", target: "es2022", sourcemap: true },
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4174",
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (request) => request.setHeader("origin", "http://127.0.0.1:4174"));
        },
      },
    },
  },
});
