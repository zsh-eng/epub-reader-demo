// Read-only source; all generated databases and private payloads stay in *.local.
import { DatabaseSync } from "node:sqlite";
import {
  gzipSync,
  gunzipSync,
  zstdCompressSync,
  zstdDecompressSync,
  constants,
} from "node:zlib";
import { mkdirSync, statSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { loadavg } from "node:os";
const input = resolve(
  process.argv[2] ?? "cutover.local/converted/backend.sqlite",
);
const output = resolve(process.argv[3] ?? "cutover.local/compression");
mkdirSync(output, { recursive: true, mode: 0o700 });
const source = new DatabaseSync(input, { readOnly: true });
const owner = source
  .prepare(
    "SELECT user_id,COUNT(*) n FROM sync_records GROUP BY user_id ORDER BY n DESC LIMIT 1",
  )
  .get().user_id;
const rows = source
  .prepare("SELECT * FROM sync_records WHERE user_id=? ORDER BY server_seq")
  .all(owner);
source.close();
const encoders = {
  plain: (s) => s,
  gzip1: (s) => gzipSync(s, { level: 1 }),
  gzip6: (s) => gzipSync(s, { level: 6 }),
  zstd3: (s) =>
    zstdCompressSync(s, { params: { [constants.ZSTD_c_compressionLevel]: 3 } }),
};
const decoders = {
  plain: (s) => s,
  gzip1: (s) => gunzipSync(s).toString(),
  gzip6: (s) => gunzipSync(s).toString(),
  zstd3: (s) => zstdDecompressSync(s).toString(),
};
const wire = (r, value = r.value) => ({
  key: r.key,
  value,
  isDeleted: !!r.is_deleted,
  schemaVersion: r.schema_version,
  hlc: { wallTimeMs: r.hlc_wall_time_ms, counter: r.hlc_counter },
  deviceId: r.device_id,
  serverSeq: r.server_seq,
});
const digest = (values) => {
  const h = createHash("sha256");
  for (const v of values) h.update(v);
  return h.digest("hex");
};
const expectedHash = digest(rows.map((r) => r.value));
const report = {
  runtime: process.version,
  records: rows.length,
  rawValueBytes: rows.reduce((n, r) => n + Buffer.byteLength(r.value), 0),
  loadStart: loadavg(),
  cases: [],
  pageCache: [],
};
const now = () => performance.now();
const encoded = {};
for (const [name, encode] of Object.entries(encoders)) {
  const t = now();
  encoded[name] = rows.map((r) => encode(r.value));
  report.cases.push({
    name,
    encodeMs: now() - t,
    storedValueBytes: encoded[name].reduce(
      (n, b) => n + (typeof b === "string" ? Buffer.byteLength(b) : b.length),
      0,
    ),
    runs: [],
  });
}
// Each mode keeps identical metadata and both production indexes.
for (let repetition = 0; repetition < 3; repetition++) {
  const modes = Object.keys(encoders);
  modes.push(...modes.splice(0, repetition));
  for (const name of modes) {
    const path = resolve(output, `${name}.sqlite`);
    rmSync(path, { force: true });
    const db = new DatabaseSync(path);
    db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
   CREATE TABLE sync_records(server_seq INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL,key TEXT NOT NULL,value ${name === "plain" ? "TEXT" : "BLOB"} NOT NULL,schema_version INTEGER NOT NULL,hlc_wall_time_ms INTEGER NOT NULL,hlc_counter INTEGER NOT NULL,device_id TEXT NOT NULL,is_deleted INTEGER NOT NULL);
   CREATE UNIQUE INDEX sync_records_user_key_unique ON sync_records(user_id,key);
   CREATE INDEX sync_records_user_seq_idx ON sync_records(user_id,server_seq);`);
    const insert = db.prepare(
      "INSERT INTO sync_records VALUES(?,?,?,?,?,?,?,?,?)",
    );
    let t = now();
    for (let i = 0; i < rows.length; i += 500) {
      db.exec("BEGIN");
      for (let j = i; j < Math.min(i + 500, rows.length); j++) {
        const r = rows[j];
        insert.run(
          r.server_seq,
          r.user_id,
          r.key,
          encoded[name][j],
          r.schema_version,
          r.hlc_wall_time_ms,
          r.hlc_counter,
          r.device_id,
          r.is_deleted,
        );
      }
      db.exec("COMMIT");
    }
    const writeMs = now() - t;
    const query = db.prepare(
      "SELECT * FROM sync_records WHERE user_id=? AND server_seq>? ORDER BY server_seq LIMIT 500",
    );
    let cursor = 0,
      count = 0,
      readMs = 0,
      decodeMs = 0,
      parseMs = 0;
    const restored = [];
    t = now();
    while (true) {
      let phase = now();
      const batch = query.all(owner, cursor);
      readMs += now() - phase;
      if (!batch.length) break;
      phase = now();
      const values = batch.map((r) => decoders[name](r.value));
      decodeMs += now() - phase;
      phase = now();
      for (const s of values) JSON.parse(s);
      parseMs += now() - phase;
      restored.push(...values);
      count += batch.length;
      cursor = batch.at(-1).server_seq;
    }
    const readDecodeParseMs = now() - t;
    if (count !== rows.length || digest(restored) !== expectedHash)
      throw Error("Round-trip mismatch");
    db.close();
    report.cases
      .find((x) => x.name === name)
      .runs.push({
        repetition,
        writeMs,
        readMs,
        decodeMs,
        parseMs,
        readDecodeParseMs,
        databaseBytes: statSync(path).size,
        verified: true,
        load: loadavg(),
      });
  }
}
// The actual JSON protocol needs base64 for opaque compressed bytes. Compare
// its final HTTP gzip size with the existing plain-value protocol.
for (const item of report.cases) {
  const records = rows.map((r, i) =>
    wire(
      r,
      item.name === "plain"
        ? r.value
        : Buffer.from(encoded[item.name][i]).toString("base64"),
    ),
  );
  let body = "";
  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500);
    body +=
      JSON.stringify({
        records: batch,
        cursor: batch.at(-1).serverSeq,
        head: records.at(-1).serverSeq,
        hasMore: i + 500 < records.length,
      }) + "\n";
  }
  item.jsonWireBytes = Buffer.byteLength(body);
  let t = now();
  const compressed = gzipSync(body);
  item.httpGzipMs = now() - t;
  item.httpGzipBytes = compressed.length;
  // Browser experiment can reuse these private, precompressed wire fixtures.
  writeFileSync(resolve(output, `${item.name}.ndjson.gz`), compressed, {
    mode: 0o600,
  });
}
// Immutable restore-page cache: different semantics from per-record storage.
for (const codec of ["gzip6", "zstd3"]) {
  const pages = [];
  let t = now();
  for (let i = 0; i < rows.length; i += 500)
    pages.push(
      encoders[codec](
        JSON.stringify(rows.slice(i, i + 500).map((r) => wire(r))),
      ),
    );
  const encodeMs = now() - t;
  t = now();
  const values = [];
  for (const p of pages)
    values.push(...JSON.parse(decoders[codec](p)).map((r) => r.value));
  const decodeParseMs = now() - t;
  if (digest(values) !== expectedHash) throw Error("Page round trip mismatch");
  report.pageCache.push({
    codec,
    pages: pages.length,
    bytes: pages.reduce((n, p) => n + p.length, 0),
    encodeMs,
    decodeParseMs,
    verified: true,
  });
}
report.loadEnd = loadavg();
writeFileSync(
  resolve(output, "storage-results.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
