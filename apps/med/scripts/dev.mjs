import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const app = fileURLToPath(new URL("..", import.meta.url));
const repos = (process.argv.length > 2 ? process.argv.slice(2) : ["."]).map((path) =>
  resolve(path),
);
const build = spawn("bun", ["run", "build:server"], { cwd: app, stdio: "inherit" });
await new Promise((resolve, reject) =>
  build.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("Server build failed")))),
);
const host = spawn(
  process.execPath,
  [resolve(app, "dist/cli.js"), ...repos, "--port", "4174", "--no-open"],
  {
    stdio: "inherit",
  },
);
const vite = spawn("bun", ["run", "vite", "--host", "127.0.0.1"], { cwd: app, stdio: "inherit" });
const close = () => {
  host.kill();
  vite.kill();
};
process.on("SIGINT", close);
process.on("SIGTERM", close);
host.on("exit", () => vite.kill());
vite.on("exit", () => host.kill());
