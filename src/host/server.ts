import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  notesRequestSchema,
  reviewRequestSchema,
  type ChangeEvent,
  type Comparison,
  type Repository,
  type Session,
} from "../shared/protocol";
import { loadHistory, listBranches, listWorktrees, resolveRepository } from "./repository/history";
import { ReviewService } from "./repository/review";
import { HostError } from "./runtime/errors";
import { ProcessFailure } from "./runtime/process";
import { watchRepository } from "./runtime/watch";
import { NoteService } from "./notes";
import { browseListRequestSchema, browseReadRequestSchema } from "../shared/browse";
import { listBrowse, readBrowse } from "./repository/browse";
import { browseBlameRequestSchema, browseSearchRequestSchema } from "../shared/inspect";
import { blameBrowse } from "./repository/inspect";
import { ZoektSearchService, type SearchOptions } from "./search/service";

export interface StartHostOptions {
  repo: string;
  port?: number;
  open?: boolean;
  webRoot?: string;
  initialComparison?: Comparison;
  allowedInputPaths?: readonly string[];
  onClose?: () => Promise<void>;
  search?: SearchOptions;
}
export interface RunningHost {
  url: string;
  token: string;
  port: number;
  close(): Promise<void>;
}
const MAX_BODY = 128 * 1024;
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const data of request) {
    const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
    bytes += chunk.byteLength;
    if (bytes > MAX_BODY)
      throw new HostError("payload-too-large", "The request body exceeds 128 KiB.", 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HostError("invalid-json", "The request body must be JSON.");
  }
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

/** Serve one local review process; Git operations never change the checkout. */
export async function startHost(options: StartHostOptions): Promise<RunningHost> {
  let repository: Repository;
  try {
    repository = { ...(await resolveRepository(resolve(options.repo))), git: true };
  } catch (error) {
    if (options.initialComparison?.kind !== "patch" && options.initialComparison?.kind !== "files")
      throw error;
    const path = await realpath(resolve(options.repo));
    if (!(await stat(path)).isDirectory())
      throw new HostError("invalid-directory", "Choose an input directory.");
    repository = {
      path,
      name: basename(path),
      head: "",
      branch: "File comparison",
      shallow: false,
      git: false,
    };
  }
  const token = randomBytes(32).toString("base64url");
  const tokenDigest = createHash("sha256").update(token).digest();
  const reviews = new ReviewService(
    new Set((options.allowedInputPaths ?? []).map((path) => resolve(path))),
  );
  const notes = new NoteService(reviews);
  const search = new ZoektSearchService(repository.path, options.search);
  const allowed = new Set<string>([repository.path]);
  allowed.add(resolve(options.repo));
  const watchers = new Map<string, Promise<() => Promise<void>>>();
  const watcherModes = new Map<string, boolean>();
  const browseLiveSources = new Set<string>();
  const streams = new Set<ServerResponse>();
  const activeRequests = new Set<AbortController>();
  let revision = 0;
  let closing = false;
  let port = 0;
  let expensiveRequests = 0;
  const webRoot = options.webRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), "web");

  const publish = (event: ChangeEvent) => {
    const frame = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const stream of streams) {
      if (stream.writableLength > 256 * 1024) {
        stream.destroy();
        streams.delete(stream);
      } else stream.write(frame);
    }
  };
  const observe = (repo: string, live = false) => {
    if ((watchers.has(repo) && watcherModes.get(repo) === live) || closing) return;
    if (watchers.size >= 8) return;
    const previous = watchers.get(repo);
    const promise = (async () => {
      if (previous) {
        try {
          await (
            await previous
          )();
        } catch {
          /* Replace a failed watcher. */
        }
      }
      return watchRepository(
        repo,
        () => {
          search.refresh();
          publish({ type: "changed", repo, revision: ++revision });
        },
        live,
      );
    })();
    watchers.set(repo, promise);
    watcherModes.set(repo, live);
    promise.catch(() => {
      if (watchers.get(repo) === promise) {
        watchers.delete(repo);
        watcherModes.delete(repo);
      }
    });
  };
  const session = async (repo: string, signal?: AbortSignal): Promise<Session> => {
    if (repository.git === false)
      return {
        protocol: 1,
        repository,
        worktrees: [],
        ...(options.initialComparison ? { initialComparison: options.initialComparison } : {}),
      };
    const [info, worktrees] = await Promise.all([
      resolveRepository(repo, signal),
      listWorktrees(repo, signal),
    ]);
    for (const worktree of worktrees) if (!worktree.bare) allowed.add(resolve(worktree.path));
    // Discovery refreshes must not downgrade an active working-file watcher.
    if (!watchers.has(info.path)) observe(info.path);
    return {
      protocol: 1,
      repository: { ...info, git: true },
      worktrees,
      ...(options.initialComparison ? { initialComparison: options.initialComparison } : {}),
    };
  };
  const requireRepo = (input: string | null) => {
    const repo = resolve(input ?? repository.path);
    if (!allowed.has(repo))
      throw new HostError(
        "repository-not-allowed",
        "Choose this repository or one of its listed worktrees.",
        403,
      );
    return repo === resolve(options.repo) ? repository.path : repo;
  };

  const server = createServer((request, response) => {
    const abort = new AbortController();
    activeRequests.add(abort);
    request.once("aborted", () => abort.abort());
    response.once("close", () => {
      if (!response.writableEnded) abort.abort();
    });
    void (async () => {
      const host = request.headers.host;
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)
        throw new HostError("forbidden-host", "The local host header is not valid.", 403);
      const url = new URL(request.url ?? "/", `http://${host}`);
      if (url.pathname.startsWith("/api/")) {
        if (request.headers.origin && request.headers.origin !== `http://${host}`)
          throw new HostError(
            "forbidden-origin",
            "Use the same local origin for API requests.",
            403,
          );
        const provided = request.headers.authorization?.replace(/^Bearer /, "") ?? "";
        if (!timingSafeEqual(tokenDigest, createHash("sha256").update(provided).digest()))
          throw new HostError("unauthorized", "Open the launch URL with its access token.", 401);
        if (url.pathname === "/api/events" && request.method === "GET") {
          const eventRepo = requireRepo(url.searchParams.get("repo"));
          if (streams.size >= 8)
            throw new HostError("too-many-streams", "Too many review event streams are open.", 503);
          response.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-store",
            connection: "keep-alive",
            "x-accel-buffering": "no",
          });
          response.write(
            `event: ready\ndata: ${JSON.stringify({ type: "ready", repo: eventRepo, revision })}\n\n`,
          );
          streams.add(response);
          response.once("close", () => streams.delete(response));
          return;
        }
        if (url.pathname === "/api/session" && request.method === "GET") {
          json(
            response,
            200,
            await session(requireRepo(url.searchParams.get("repo")), abort.signal),
          );
          return;
        }
        if (url.pathname === "/api/notes" && request.method === "GET") {
          json(response, 200, notes.get(url.searchParams.get("reviewId") ?? ""));
          return;
        }
        if (expensiveRequests >= 8)
          throw new HostError("busy", "The host is processing other requests. Retry shortly.", 503);
        expensiveRequests++;
        try {
          if (url.pathname === "/api/browse/list" && request.method === "POST") {
            const input = browseListRequestSchema.parse(await readBody(request));
            input.source.repo = requireRepo(input.source.repo);
            if (input.source.kind === "worktree") {
              browseLiveSources.add(input.source.repo);
              observe(input.source.repo, true);
            }
            json(response, 200, await listBrowse(input.source, input.ignored, abort.signal));
            return;
          }
          if (url.pathname === "/api/browse/read" && request.method === "POST") {
            const input = browseReadRequestSchema.parse(await readBody(request));
            input.source.repo = requireRepo(input.source.repo);
            if (input.source.kind === "worktree") {
              browseLiveSources.add(input.source.repo);
              observe(input.source.repo, true);
            }
            json(response, 200, await readBrowse(input.source, input.path, abort.signal));
            return;
          }
          if (url.pathname === "/api/browse/search" && request.method === "POST") {
            const input = browseSearchRequestSchema.parse(await readBody(request));
            input.source.repo = requireRepo(input.source.repo);
            json(response, 200, await search.search(input.source, input.query, abort.signal));
            return;
          }
          if (url.pathname === "/api/search/status" && request.method === "GET") {
            json(response, 200, search.status());
            return;
          }
          if (url.pathname === "/api/browse/blame" && request.method === "POST") {
            const input = browseBlameRequestSchema.parse(await readBody(request));
            input.source.repo = requireRepo(input.source.repo);
            json(response, 200, await blameBrowse(input, abort.signal));
            return;
          }
          if (url.pathname === "/api/branches" && request.method === "GET") {
            const repo = requireRepo(url.searchParams.get("repo"));
            if (repository.git === false) {
              json(response, 200, []);
              return;
            }
            const worktrees = await listWorktrees(repo, abort.signal);
            for (const worktree of worktrees)
              if (!worktree.bare) allowed.add(resolve(worktree.path));
            json(response, 200, await listBranches(repo, abort.signal, worktrees));
            return;
          }
          if (url.pathname === "/api/history" && request.method === "GET") {
            if (repository.git === false) {
              json(response, 200, { commits: [], cursor: null, hasMore: false });
              return;
            }
            json(
              response,
              200,
              await loadHistory(
                requireRepo(url.searchParams.get("repo")),
                url.searchParams.get("cursor"),
                Number(url.searchParams.get("limit") ?? 50),
                abort.signal,
                url.searchParams.get("ref") ?? undefined,
              ),
            );
            return;
          }
          if (url.pathname === "/api/review" && request.method === "POST") {
            const input = reviewRequestSchema.parse(await readBody(request));
            input.repo = requireRepo(input.repo);
            if (
              repository.git === false &&
              input.comparison.kind !== "patch" &&
              input.comparison.kind !== "files"
            )
              throw new HostError(
                "not-a-git-repository",
                "This directory supports patch and file inputs only.",
                422,
              );
            if (repository.git !== false)
              observe(
                input.repo,
                browseLiveSources.has(input.repo) ||
                  input.comparison.kind === "working" ||
                  input.comparison.kind === "unstaged",
              );
            const review = await reviews.load(input, abort.signal);
            notes.adopt(review.id);
            json(response, 200, review);
            return;
          }
          if (url.pathname === "/api/source" && request.method === "GET") {
            json(
              response,
              200,
              await reviews.sources(
                url.searchParams.get("reviewId") ?? "",
                url.searchParams.get("path") ?? "",
                abort.signal,
              ),
            );
            return;
          }
          if (url.pathname === "/api/notes" && request.method === "POST") {
            const input = notesRequestSchema.parse(await readBody(request));
            json(
              response,
              200,
              await notes.mutate(
                input.reviewId,
                input.expectedRevision,
                input.mutation,
                abort.signal,
              ),
            );
            return;
          }
        } finally {
          expensiveRequests--;
        }
        throw new HostError("not-found", "This API route does not exist.", 404);
      }
      if (request.method !== "GET" && request.method !== "HEAD")
        throw new HostError("method-not-allowed", "Use GET for application files.", 405);
      let path: string;
      try {
        path = decodeURIComponent(url.pathname);
      } catch {
        throw new HostError("invalid-path", "This URL path is not valid.");
      }
      const file = resolve(webRoot, `.${path === "/" ? "/index.html" : path}`);
      const rel = relative(webRoot, file);
      if (rel.startsWith("..") || isAbsolute(rel))
        throw new HostError("invalid-path", "This asset path is not valid.", 403);
      let data: Buffer;
      try {
        const info = await stat(file);
        if (!info.isFile() || info.size > 32 * 1024 * 1024) throw new Error("not an asset");
        data = await readFile(file);
      } catch {
        if (path === "/") {
          response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          response.end(
            "<!doctype html><title>Med host</title><p>The review host is ready. Build the web application to serve its interface.</p>",
          );
          return;
        }
        throw new HostError("not-found", "This application asset does not exist.", 404);
      }
      response.writeHead(200, {
        "content-type": MIME[extname(file)] ?? "application/octet-stream",
        "cache-control":
          path === "/" || path.endsWith(".html")
            ? "no-store"
            : "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "content-security-policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' data:; font-src 'self' data:; frame-ancestors 'none'; base-uri 'none'",
      });
      response.end(request.method === "HEAD" ? undefined : data);
    })()
      .catch((error: unknown) => {
        if (response.headersSent || response.destroyed) {
          response.destroy();
          return;
        }
        const status =
          error instanceof HostError
            ? error.status
            : error instanceof z.ZodError
              ? 400
              : error instanceof ProcessFailure
                ? error.code === "output-too-large"
                  ? 413
                  : error.code === "cancelled"
                    ? 499
                    : 422
                : 500;
        const code =
          error instanceof HostError || error instanceof ProcessFailure
            ? error.code
            : error instanceof z.ZodError
              ? "invalid-request"
              : "internal-error";
        const message =
          error instanceof Error ? error.message : "The host could not complete the request.";
        json(response, status, { error: { code, message } });
      })
      .finally(() => {
        activeRequests.delete(abort);
      });
  });
  server.requestTimeout = 35_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolvePromise();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("The local server did not open a TCP port.");
  port = address.port;
  if (repository.git !== false) await search.start();
  if (options.open) {
    const command =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "explorer.exe"
          : "xdg-open";
    const child = spawn(command, [`http://127.0.0.1:${port}/#token=${token}`], {
      stdio: "ignore",
      detached: true,
      shell: false,
    });
    child.on("error", () => {
      /* The caller still receives a usable launch URL. */
    });
    child.unref();
  }
  const heartbeat = setInterval(() => {
    for (const stream of streams) stream.write(": heartbeat\n\n");
  }, 15_000);
  heartbeat.unref();
  return {
    url: `http://127.0.0.1:${port}/#token=${token}`,
    token,
    port,
    async close() {
      if (closing) return;
      closing = true;
      clearInterval(heartbeat);
      for (const abort of activeRequests) abort.abort();
      for (const stream of streams) stream.end();
      streams.clear();
      await Promise.allSettled([...watchers.values()].map(async (stop) => (await stop)()));
      await search.close();
      reviews.clear();
      notes.clear();
      await new Promise<void>((resolvePromise) => {
        server.close(() => resolvePromise());
        server.closeAllConnections();
      });
      await options.onClose?.();
    },
  };
}
