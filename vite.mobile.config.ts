import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import path from "node:path";
import { VitePWA } from "vite-plugin-pwa";

// A complete, offline web runtime. No Worker backend or service worker is needed
// inside the app: the native loopback server serves these bundled resources.
export default defineConfig({
  plugins: [react(), tailwindcss(), VitePWA({ disable: true })],
  define: { "import.meta.env.VITE_NATIVE_APP": JSON.stringify("true") },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  build: {
    outDir: "apps/mobile/modules/reader-runtime/ios/Resources/web",
    emptyOutDir: true,
  },
});
