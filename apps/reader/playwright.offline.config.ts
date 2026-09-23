import config from "./playwright.config";
export default {
  ...config,
  use: { ...config.use, baseURL: "http://127.0.0.1:5193" },
  webServer: {
    ...config.webServer,
    command:
      "bun run dev --config test/e2e/vite.config.ts --host 127.0.0.1 --port 5193 --strictPort",
    url: "http://127.0.0.1:5193",
  },
};
