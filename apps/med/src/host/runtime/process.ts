import { spawn } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";

const gitMetrics = new AsyncLocalStorage<{ ms: number }>();
export async function measureGit<T>(work: () => Promise<T>) {
  const metrics = { ms: 0 };
  const value = await gitMetrics.run(metrics, work);
  return { value, gitMs: metrics.ms };
}

export class ProcessFailure extends Error {
  constructor(
    message: string,
    readonly code: "command-failed" | "output-too-large" | "cancelled" | "timeout",
    readonly stderr = "",
  ) {
    super(message);
    this.name = "ProcessFailure";
  }
}

export interface ProcessOptions {
  cwd: string;
  signal?: AbortSignal;
  maxBytes?: number;
  timeoutMs?: number;
  acceptedExitCodes?: readonly number[];
  env?: NodeJS.ProcessEnv;
  input?: string | Buffer;
}

/** Run argument arrays with bounded output and terminate owned children on cancellation. */
export function runProcess(command: string, args: readonly string[], options: ProcessOptions) {
  options.signal?.throwIfAborted();
  return new Promise<{ stdout: Buffer; stderr: string; exitCode: number }>((resolve, reject) => {
    const maxBytes = options.maxBytes ?? 16 * 1024 * 1024;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdin.on("error", () => {
      /* The child may close its input before consuming it. */
    });
    child.stdin.end(options.input);
    const chunks: Buffer[] = [];
    const diagnostics: Buffer[] = [];
    let bytes = 0;
    let errorBytes = 0;
    let failure: Error | undefined;
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    const kill = (signal: NodeJS.Signals) => {
      if (child.pid && process.platform !== "win32") {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
          /* The process may have exited. */
        }
      }
      child.kill(signal);
    };
    const stop = (error: Error) => {
      if (failure) return;
      failure = error;
      kill("SIGTERM");
      forceTimer = setTimeout(() => kill("SIGKILL"), 250);
      forceTimer.unref();
    };
    const abort = () => stop(new ProcessFailure("The request was cancelled.", "cancelled"));
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    const timer = setTimeout(
      () => stop(new ProcessFailure("The Git request timed out.", "timeout")),
      options.timeoutMs ?? 30_000,
    );
    timer.unref();
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > maxBytes) {
        stop(
          new ProcessFailure(
            `Command output exceeds the ${maxBytes}-byte limit. Narrow the comparison.`,
            "output-too-large",
          ),
        );
      } else if (!failure) chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errorBytes += chunk.byteLength;
      if (errorBytes <= 64 * 1024) diagnostics.push(chunk);
      else
        stop(new ProcessFailure("Command diagnostics exceed the size limit.", "output-too-large"));
    });
    const cleanup = () => {
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      options.signal?.removeEventListener("abort", abort);
    };
    child.once("error", (error) => {
      failure ??= error;
    });
    child.once("close", (exitCode) => {
      cleanup();
      if (failure) {
        reject(failure);
        return;
      }
      const stderr = Buffer.concat(diagnostics).toString("utf8").trim();
      if (!(options.acceptedExitCodes ?? [0]).includes(exitCode ?? -1)) {
        reject(
          new ProcessFailure(
            stderr || `${command} exited with status ${exitCode}.`,
            "command-failed",
            stderr,
          ),
        );
        return;
      }
      resolve({ stdout: Buffer.concat(chunks), stderr, exitCode: exitCode ?? 0 });
    });
  });
}

/** Disable optional writes and external converters for deterministic review commands. */
export async function git(
  repo: string,
  args: readonly string[],
  options: Omit<ProcessOptions, "cwd"> = {},
) {
  const started = performance.now();
  try {
    return (
      await runProcess(
        "git",
        [
          "--no-optional-locks",
          "-c",
          "core.quotePath=true",
          "-c",
          "diff.noprefix=false",
          "-c",
          "core.fsmonitor=false",
          "-c",
          "diff.mnemonicPrefix=false",
          "-c",
          "diff.srcPrefix=a/",
          "-c",
          "diff.dstPrefix=b/",
          ...args,
        ],
        {
          ...options,
          cwd: repo,
          env: { ...options.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" },
        },
      )
    ).stdout;
  } finally {
    const metrics = gitMetrics.getStore();
    if (metrics) metrics.ms += performance.now() - started;
  }
}
