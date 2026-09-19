import path from "node:path";

/** Local production-asset server. Faults apply after the real PWA cache, including
 * worker requests. No application fetch patch or replacement service worker.
 * Control is on a separate loopback port so a stalled page cannot hide it.
 * Run `bun run diagnostics:network`, import a book, and wait for offline-ready.
 * Hold fonts: curl -X POST http://127.0.0.1:5197 -H 'Content-Type: application/json'
 *   -d '{"target":"fonts","mode":"hold"}'
 * Then reopen the app. POST {"target":"all","mode":"pass"} to release/reset.
 * GET the control address for requests that actually reached the network.
 * Targets: all/auth/files/fonts/assets. Modes: pass/hold/delay/fail.
 * Delay takes delayMs. The app stays online; use browser offline mode separately.
 * This serves dist/client with a signed-out API fixture, not a live backend.
 * Cross-origin requests bypass it; the build must use this origin for auth.
 */
const port = Number(process.env.NETWORK_LAB_PORT ?? 5196);
const root = path.resolve("dist/client");
const targets = {
  all: () => true,
  auth: (url: URL) => url.pathname.startsWith("/api/auth/"),
  files: (url: URL) => url.pathname.startsWith("/api/files/"),
  fonts: (url: URL) => /\.(woff2?|ttf|otf)$/.test(url.pathname),
  assets: (url: URL) => url.pathname.startsWith("/assets/"),
};
type Rule = {
  target: keyof typeof targets;
  mode: "pass" | "hold" | "delay" | "fail";
  delayMs: number;
};
let rule: Rule = { target: "all", mode: "pass", delayMs: 0 };
const held = new Set<() => void>();
const requests: {
  path: string;
  mode: string;
  started: number;
  finished?: number;
}[] = [];

function release() {
  for (const resolve of held) resolve();
  held.clear();
}

Bun.serve({
  hostname: "127.0.0.1",
  port,
  idleTimeout: 0,
  async fetch(request) {
    const url = new URL(request.url);
    const active = rule;
    const mode = targets[active.target](url) ? active.mode : "pass";
    const entry = {
      path: url.pathname,
      mode,
      started: Date.now(),
      finished: undefined as number | undefined,
    };
    requests.push(entry);
    if (requests.length > 1000) requests.shift();
    try {
      if (mode === "hold") {
        await new Promise<void>((resolve) => {
          const done = () => {
            held.delete(done);
            request.signal.removeEventListener("abort", done);
            resolve();
          };
          held.add(done);
          request.signal.addEventListener("abort", done, { once: true });
          if (request.signal.aborted) done();
        });
      }
      if (mode === "delay") await Bun.sleep(active.delayMs);
      if (mode === "fail") return Response.error();

      // Deliberately signed out: this tool isolates startup, not real server sync.
      if (url.pathname === "/api/auth/get-session") return Response.json(null);
      if (url.pathname.startsWith("/api/"))
        return new Response("Not found", { status: 404 });
      const filename = path.resolve(
        root,
        `.${decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)}`,
      );
      if (!filename.startsWith(`${root}/`))
        return new Response("Not found", { status: 404 });
      let file = Bun.file(filename);
      if (!(await file.exists())) {
        if (!request.headers.get("accept")?.includes("text/html"))
          return new Response("Not found", { status: 404 });
        file = Bun.file(path.join(root, "index.html"));
      }
      // Make HTTP-cache dependence visible. CacheStorage remains intact.
      return new Response(file, { headers: { "Cache-Control": "no-store" } });
    } finally {
      entry.finished = Date.now();
    }
  },
});

Bun.serve({
  hostname: "127.0.0.1",
  port: port + 1,
  async fetch(request) {
    if (request.method === "POST") {
      // Only CLI/test clients may change rules; browsers cannot post cross-origin.
      if (request.headers.has("origin"))
        return new Response("Use curl", { status: 403 });
      const next = await request.json().catch(() => null);
      if (
        !next ||
        !Object.hasOwn(targets, next.target) ||
        !["pass", "hold", "delay", "fail"].includes(next.mode) ||
        (next.mode === "delay" &&
          (!Number.isFinite(next.delayMs) ||
            next.delayMs < 0 ||
            next.delayMs > 120_000))
      ) {
        return new Response(
          "Expected target, mode, and delayMs (0–120000 for delay)",
          { status: 400 },
        );
      }
      rule = {
        target: next.target,
        mode: next.mode,
        delayMs: next.delayMs ?? 0,
      };
      release();
      requests.length = 0;
    }
    return Response.json({ rule, held: held.size, requests });
  },
});
console.log(
  `Network lab: http://127.0.0.1:${port}; control/log: http://127.0.0.1:${port + 1}`,
);
