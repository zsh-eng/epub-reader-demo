import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const fixtureRoot = fileURLToPath(new URL(".", import.meta.url));
const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const workspaceRoot = fileURLToPath(new URL("../../../..", import.meta.url));

export default defineConfig({
  root: fixtureRoot,
  optimizeDeps: {
    exclude: ["@sqlite.org/sqlite-wasm"],
  },
  server: {
    host: "127.0.0.1",
    port: 4178,
    strictPort: true,
    headers: {
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
    },
    fs: {
      allow: [packageRoot, workspaceRoot],
    },
  },
});
