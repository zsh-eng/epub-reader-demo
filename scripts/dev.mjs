import { spawn } from "node:child_process";
const repo = process.argv[2] ?? ".";
const build = spawn("npm", ["run", "build:server"], { stdio: "inherit" });
await new Promise((resolve, reject) =>
  build.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("Server build failed")))),
);
const host = spawn(process.execPath, ["dist/cli.js", repo, "--port", "4174", "--no-open"], {
  stdio: "inherit",
});
const vite = spawn("npm", ["exec", "vite", "--", "--host", "127.0.0.1"], { stdio: "inherit" });
const close = () => {
  host.kill();
  vite.kill();
};
process.on("SIGINT", close);
process.on("SIGTERM", close);
host.on("exit", () => vite.kill());
vite.on("exit", () => host.kill());
