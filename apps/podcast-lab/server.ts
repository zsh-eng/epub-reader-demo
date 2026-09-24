/** Offline demo host. Only explicit public assets are exposed; keys and raw logs stay private. */
import { join } from "node:path";
const app = import.meta.dir;
export function createServer(dataDir = join(app, ".local"), port = 4378) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(request) {
      const url = new URL(request.url);
      if (!["127.0.0.1", "localhost"].includes(url.hostname))
        return new Response("Invalid host", { status: 403 });
      if (!["GET", "HEAD"].includes(request.method))
        return new Response("Method not allowed", { status: 405 });
      const assets: Record<string, string> = {
        "/": join(app, "web/index.html"),
        "/player.js": join(app, "dist/player.js"),
        "/style.css": join(app, "web/style.css"),
        "/episode.json": join(dataDir, "episode.json"),
        "/artwork": join(dataDir, "artwork.webp"),
      };
      if (url.pathname === "/audio") {
        const file = Bun.file(join(dataDir, "episode.mp3"));
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
      const path = assets[url.pathname];
      if (!path) return new Response("Not found", { status: 404 });
      const file = Bun.file(path);
      if (!(await file.exists()))
        return new Response("Run the pipeline first. See README.md.", {
          status: 503,
        });
      return new Response(request.method === "HEAD" ? null : file, {
        headers: {
          "Cache-Control": "no-cache",
          "X-Content-Type-Options": "nosniff",
        },
      });
    },
  });
}
if (import.meta.main) {
  const server = createServer(process.env.PODCAST_DATA_DIR);
  console.log(`Undertone → ${server.url}`);
}
