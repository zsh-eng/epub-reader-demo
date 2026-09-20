#!/usr/bin/env node
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { startHost } from "../host/server";
import type { Comparison } from "../shared/protocol";
import { ctagsSetupMessage, discoverCtags } from "../host/search/symbols";
import { installSearchTools } from "../host/search/install";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  allowNegative: true,
  options: {
    port: { type: "string" },
    open: { type: "boolean", default: true },
    help: { type: "boolean", short: "h" },
    patch: { type: "string" },
    files: { type: "boolean" },
    "setup-search": { type: "boolean" },
  },
});
if (values.help) {
  console.log(
    "Usage: med-diff [repository] [--port <port>] [--no-open]\n       med-diff --patch <path|-> [--no-open]\n       med-diff --files <old> <new> [--no-open]\n       med-diff --setup-search\n\nOpen a local, read-only review. Use --patch - to read a patch from stdin.\nSetup search builds pinned Zoekt binaries once; it requires Go during setup only.",
  );
} else if (values["setup-search"]) {
  console.log("Setting up pinned Zoekt search tools…");
  const result = await installSearchTools();
  console.log(`Search tools ready: ${result.binDir}`);
  const ctags = await discoverCtags();
  console.log(ctags ? `Symbol extraction ready: ${ctags.path}` : ctagsSetupMessage);
} else {
  const port = values.port === undefined ? undefined : Number(values.port);
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535))
    throw new Error("Port must be between 0 and 65535.");
  if (values.patch && values.files) throw new Error("Choose either --patch or --files.");
  let initialComparison: Comparison | undefined;
  let ownedTemporary: string | undefined;
  const allowedInputPaths: string[] = [];
  if (values.patch) {
    let path: string;
    if (values.patch === "-") {
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const input of process.stdin) {
        const chunk = Buffer.isBuffer(input) ? input : Buffer.from(input);
        bytes += chunk.byteLength;
        if (bytes > 16 * 1024 * 1024) throw new Error("The stdin patch exceeds 16 MiB.");
        chunks.push(chunk);
      }
      ownedTemporary = await mkdtemp(join(tmpdir(), "med-stdin-"));
      path = join(ownedTemporary, "stdin.patch");
      await writeFile(path, Buffer.concat(chunks), { mode: 0o600 });
    } else path = resolve(values.patch);
    initialComparison = { kind: "patch", path };
    allowedInputPaths.push(path);
  } else if (values.files) {
    if (positionals.length !== 2) throw new Error("Use --files <old> <new>.");
    const oldPath = resolve(positionals[0]!),
      newPath = resolve(positionals[1]!);
    initialComparison = { kind: "files", oldPath, newPath };
    allowedInputPaths.push(oldPath, newPath);
  }
  const cleanup = async () => {
    if (ownedTemporary) await rm(ownedTemporary, { recursive: true, force: true });
  };
  const host = await startHost({
    repo: initialComparison ? process.cwd() : resolve(positionals[0] ?? process.cwd()),
    ...(port !== undefined ? { port } : {}),
    ...(initialComparison ? { initialComparison } : {}),
    allowedInputPaths,
    onClose: cleanup,
  }).catch(async (error: unknown) => {
    await cleanup();
    throw error;
  });
  console.log(`Med review: ${host.url}`);
  if (values.open) {
    const command =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "explorer.exe"
          : "xdg-open";
    const child = spawn(command, [host.url], { stdio: "ignore", detached: true, shell: false });
    child.on("error", () => console.error("Could not open a browser. Use the launch URL above."));
    child.unref();
  }
  let stopping = false;
  const close = () => {
    if (!stopping) {
      stopping = true;
      void host.close().catch((error: unknown) => {
        console.error(error);
        process.exitCode = 1;
      });
    }
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}
