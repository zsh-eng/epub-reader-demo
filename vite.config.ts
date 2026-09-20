import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import stylex from "@stylexjs/unplugin";

export default defineConfig({
  plugins: [stylex.vite({ useCSSLayers: true }), react()],
  optimizeDeps: { include: ["@base-ui/react/combobox", "@base-ui/react/tabs", "@pierre/trees"] },
  worker: { format: "es" },
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
