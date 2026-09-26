/** Offline demo host. Only explicit public assets are exposed; keys and raw logs stay private. */
import { join } from "node:path";
import catalog from "./feeds.json";
import { Preparations, type Runner } from "./preparation";
const app = import.meta.dir;
export function createServer(
  dataDir = join(app, ".local"),
  port = 4378,
  runner?: Runner,
) {
  const preparations = new Preparations(dataDir, runner);
  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(request) {
      const url = new URL(request.url);
      if (!["127.0.0.1", "localhost"].includes(url.hostname))
        return new Response("Invalid host", { status: 403 });
      const jobRoute = /^\/api\/preparations\/([a-f0-9]{20})$/.exec(
        url.pathname,
      );
      const draftRoute = /^\/api\/preparations\/([a-f0-9]{20})\/draft$/.exec(
        url.pathname,
      );
      if (draftRoute && request.method === "GET") {
        const file = Bun.file(
          join(preparations.folder(draftRoute[1]), "draft.json"),
        );
        if (!(await file.exists()))
          return new Response("Draft unavailable", { status: 404 });
        return new Response(file, {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        });
      }
      if (jobRoute) {
        if (request.method === "GET")
          return Response.json(await preparations.status(jobRoute[1]), {
            headers: { "Cache-Control": "no-store" },
          });
        if (request.method !== "POST")
          return new Response("Method not allowed", { status: 405 });
        // No cross-origin website can start downloads, inference, or paid text
        // requests through this loopback service. Never accept caller URLs.
        if (
          request.headers.get("Origin") !== url.origin ||
          request.headers.get("X-Undertone-Preparation") !== "1"
        )
          return new Response("Same-origin request required", { status: 403 });
        if (process.env.PODCAST_PREPARATION_DISABLED === "1")
          return Response.json(
            {
              phase: "failed",
              detail: "Preparation is disabled in this test server.",
            },
            { status: 503 },
          );
        const state = await preparations.start(jobRoute[1]);
        return state
          ? Response.json(state, {
              status: 202,
              headers: { "Cache-Control": "no-store" },
            })
          : new Response("Episode not found", { status: 404 });
      }
      if (url.pathname === "/api/preparations" && request.method === "GET")
        return Response.json(await preparations.ready(), {
          headers: { "Cache-Control": "no-store" },
        });
      if (!["GET", "HEAD"].includes(request.method))
        return new Response("Method not allowed", { status: 405 });
      const folders: Record<string, string> = {
        ezra: dataDir,
        decoder: join(dataDir, "benchmark/decoder"),
        darknet: join(dataDir, "benchmark/darknet"),
        "99pi": join(dataDir, "benchmark/99pi"),
      };
      const episodeRoute =
        /^\/episodes\/(ezra|decoder|darknet|99pi|[a-f0-9]{20})\/(episode\.json|analysis\.json|audio)$/.exec(
          url.pathname,
        );
      if (
        episodeRoute &&
        !folders[episodeRoute[1]] &&
        (await preparations.status(episodeRoute[1])).phase !== "ready" &&
        !(
          episodeRoute[2] !== "episode.json" &&
          (await Bun.file(
            join(preparations.folder(episodeRoute[1]), "analysis-state.json"),
          ).exists())
        )
      )
        return new Response("Episode is not ready", { status: 404 });
      const episodeDir = episodeRoute
        ? (folders[episodeRoute[1]] ?? preparations.folder(episodeRoute[1]))
        : dataDir;
      const route = episodeRoute ? "/" + episodeRoute[2] : url.pathname;
      const showCover = /^\/shows\/([a-z0-9-]+)\/artwork$/.exec(route);
      if (showCover) {
        const slug = showCover[1];
        if (!catalog.some((show) => show.id === slug) && !folders[slug])
          return new Response("Not found", { status: 404 });
        const cached = Bun.file(join(dataDir, "feeds", slug, "artwork.webp"));
        const file = (await cached.exists())
          ? cached
          : Bun.file(
              join(
                folders[slug] ?? join(dataDir, "feeds", slug),
                "artwork.webp",
              ),
            );
        if (!(await file.exists()))
          return new Response("Not found", { status: 404 });
        return new Response(request.method === "HEAD" ? null : file, {
          headers: {
            "Content-Type": "image/webp",
            "Cache-Control": "private, max-age=3600",
          },
        });
      }
      const assets: Record<string, string> = {
        "/": join(app, "web/index.html"),
        "/player.js": join(app, "dist/player.js"),
        "/style.css": join(app, "web/style.css"),
        "/episode.json": join(episodeDir, "episode.json"),
        "/analysis.json": join(episodeDir, "analysis.json"),
        "/library.json": join(dataDir, "library.json"),
        "/library.css": join(app, "web/library.css"),
        "/artwork": join(dataDir, "artwork.webp"),
      };
      // Only generated content-addressed WebP portraits; no arbitrary files.
      const avatar = /^\/avatars\/([a-f0-9]{64}\.webp)$/.exec(url.pathname);
      if (avatar) {
        const file = Bun.file(join(dataDir, "avatars", avatar[1]));
        if (!(await file.exists()))
          return new Response("Not found", { status: 404 });
        return new Response(request.method === "HEAD" ? null : file, {
          headers: {
            "Content-Type": "image/webp",
            "Content-Length": String(file.size),
            "Cache-Control": "private, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      if (route === "/audio") {
        const file = Bun.file(join(episodeDir, "episode.mp3"));
        if (!(await file.exists()))
          return new Response("Download the episode first", { status: 404 });
        const size = file.size;
        const headers = {
          "Content-Type": "audio/mpeg",
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, max-age=0, must-revalidate",
        };
        const range = request.headers.get("Range");
        if (!range)
          return new Response(request.method === "HEAD" ? null : file, {
            headers: { ...headers, "Content-Length": String(size) },
          });
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match || (!match[1] && !match[2]))
          return new Response(null, {
            status: 416,
            headers: { "Content-Range": `bytes */${size}` },
          });
        const start = match[1]
          ? Number(match[1])
          : Math.max(0, size - Number(match[2]));
        const end = match[1]
          ? match[2]
            ? Math.min(Number(match[2]), size - 1)
            : size - 1
          : size - 1;
        if (
          start >= size ||
          end < start ||
          (match[1] === "" && Number(match[2]) === 0)
        )
          return new Response(null, {
            status: 416,
            headers: { "Content-Range": `bytes */${size}` },
          });
        return new Response(
          request.method === "HEAD" ? null : file.slice(start, end + 1),
          {
            status: 206,
            headers: {
              ...headers,
              "Content-Length": String(end - start + 1),
              "Content-Range": `bytes ${start}-${end}/${size}`,
            },
          },
        );
      }
      const path = assets[route];
      if (!path) return new Response("Not found", { status: 404 });
      const file = Bun.file(path);
      if (!(await file.exists()))
        return new Response("Run the pipeline first. See README.md.", {
          status: 503,
        });
      const etag = `W/"${file.size}-${file.lastModified}"`;
      const headers = {
        "Cache-Control": "private, no-cache",
        ETag: etag,
        "X-Content-Type-Options": "nosniff",
        ...(route === "/library.json" ? { Vary: "Accept-Encoding" } : {}),
      };
      if (request.headers.get("If-None-Match") === etag)
        return new Response(null, { status: 304, headers });
      if (route === "/library.json") {
        const compressed = Bun.file(path + ".gz");
        const cacheHeaders = {
          ...headers,
          Vary: "Accept-Encoding",
          "Content-Type": "application/json",
        };
        const acceptsGzip = request.headers
          .get("Accept-Encoding")
          ?.split(",")
          .some((value) => {
            const [encoding, ...parameters] = value.trim().split(";");
            const quality = parameters
              .map((p) => p.trim())
              .find((p) => p.startsWith("q="));
            return (
              encoding === "gzip" && (!quality || Number(quality.slice(2)) > 0)
            );
          });
        if (
          acceptsGzip &&
          (await compressed.exists()) &&
          compressed.lastModified >= file.lastModified
        )
          return new Response(request.method === "HEAD" ? null : compressed, {
            headers: { ...cacheHeaders, "Content-Encoding": "gzip" },
          });
        return new Response(request.method === "HEAD" ? null : file, {
          headers: cacheHeaders,
        });
      }
      return new Response(request.method === "HEAD" ? null : file, { headers });
    },
  });
}
if (import.meta.main) {
  const server = createServer(
    process.env.PODCAST_DATA_DIR,
    Number(process.env.PORT ?? 4378),
  );
  console.log(`Undertone → ${server.url}`);
}
