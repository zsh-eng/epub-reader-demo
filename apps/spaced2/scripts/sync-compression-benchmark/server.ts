// Private loopback fixtures only. No production requests or writes.
const cleanupOnly = process.argv.includes("--cleanup-only");
const build = await Bun.build({
  entrypoints: ["scripts/sync-compression-benchmark/browser.ts"],
  target: "browser",
  plugins: [
    {
      name: "same-fast-decoder-for-all-cases",
      setup(b) {
        b.onLoad(
          { filter: /\/src\/lib\/sync\/(records|schema)\.ts$/ },
          async ({ path }) => {
            let contents = await Bun.file(path).text();
            if (path.endsWith("/records.ts"))
              contents = contents.replace(
                "toStoredOperation(operationSchema.parse(raw))",
                "toStoredOperation(raw)",
              );
            if (path.endsWith("/schema.ts"))
              contents = contents.replace(
                "export const operationSchema = z.union([",
                'export const operationSchema = z.discriminatedUnion("type", [',
              );
            return { contents, loader: "ts" };
          },
        );
      },
    },
  ],
});
if (!build.success) throw Error(JSON.stringify(build.logs));
const bundle = await build.outputs[0].text();
Bun.serve({
  hostname: "127.0.0.1",
  port: 5290,
  idleTimeout: 120,
  async fetch(req) {
    const u = new URL(req.url);
    if (
      u.host !== "127.0.0.1:5290" ||
      (req.headers.get("origin") && req.headers.get("origin") !== u.origin)
    )
      return new Response("Forbidden", { status: 403 });
    if (u.pathname === "/")
      return new Response(
        `${cleanupOnly ? "<style>#run{display:none}</style>" : ""}<button id="run">Run compression comparison</button><button id="cleanup">Cleanup</button><pre id="status">Ready</pre><script type="module" src="/app.js"></script>`,
        { headers: { "content-type": "text/html" } },
      );
    if (u.pathname === "/app.js")
      return new Response(bundle, {
        headers: { "content-type": "text/javascript" },
      });
    if (!cleanupOnly && /^\/data\/(plain|gzip6|zstd3)$/.test(u.pathname))
      return new Response(
        Bun.file(
          `cutover.local/compression/${u.pathname.split("/").at(-1)}.ndjson.gz`,
        ),
        {
          headers: {
            "content-type": "application/x-ndjson",
            "content-encoding": "gzip",
            "cache-control": "no-store",
          },
        },
      );
    if (u.pathname === "/results" && req.method === "POST") {
      await Bun.write(
        "cutover.local/compression/browser-results.json",
        JSON.stringify(await req.json(), null, 2),
      );
      return new Response("saved");
    }
    return new Response("Not found", { status: 404 });
  },
});
console.log("http://127.0.0.1:5290");
