import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

const repositoryRoot = path.resolve(__dirname, "../..");

export default defineConfig({
  root: __dirname,
  plugins: [
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler"]],
      },
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(repositoryRoot, "src"),
      "@server": path.resolve(repositoryRoot, "server"),
    },
  },
  build: {
    outDir: path.resolve(
      repositoryRoot,
      "diagnostics/highlights-performance/site",
    ),
    emptyOutDir: true,
  },
});
