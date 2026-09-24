import { defineConfig } from "vite";
export default defineConfig({
  publicDir: false,
  build: {
    ssr: "src/cli/index.ts",
    outDir: "dist",
    emptyOutDir: false,
    target: "node22",
    sourcemap: true,
    rolldownOptions: { output: { entryFileNames: "cli.js" } },
  },
});
