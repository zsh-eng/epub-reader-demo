/** Local files only. Copies a backup; never writes the input or contacts D1. */
import { Database } from "bun:sqlite";
import {
  existsSync,
  copyFileSync,
  writeFileSync,
  realpathSync,
  renameSync,
  chmodSync,
} from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { SYNC_D1_SCHEMA_SQL } from "@zsh-eng/local-sync/hono";
import { convertRow, legacyTables } from "./convert";

const [sourceArg, targetArg] = process.argv.slice(2);
if (!sourceArg || !targetArg)
  throw Error(
    "Usage: bun scripts/sync-migration/seed.ts source.sqlite new-target.sqlite",
  );
const source = realpathSync(sourceArg),
  target = resolve(targetArg);
if (
  source === target ||
  [
    target,
    target + ".partial",
    target + ".sql",
    target + ".manifest.json",
  ].some(existsSync)
)
  throw Error("Target must be a new file; source is never modified");
const temporary = target + ".partial";
copyFileSync(source, temporary);
chmodSync(temporary, 0o600);
const db = new Database(temporary);
db.exec("PRAGMA foreign_keys=ON");
const counts: Record<string, number> = {};
let seq = 0;
db.transaction(() => {
  db.exec(SYNC_D1_SCHEMA_SQL);
  if (db.query("SELECT count(*) n FROM sync_records").get().n)
    throw Error("Source already contains sync records");
  const insert = db.prepare(
    "INSERT INTO sync_records(server_seq,user_id,key,value,schema_version,hlc_wall_time_ms,hlc_counter,device_id,is_deleted) VALUES(?,?,?,?,?,?,?,?,?)",
  );
  for (const table of legacyTables) {
    const rows = db
      .query(`SELECT * FROM ${table} ORDER BY user_id,seq_no`)
      .all();
    counts[table] = rows.length;
    for (const row of rows) {
      const { userId, record: r } = convertRow(table, row as never, ++seq);
      insert.run(
        r.serverSeq,
        userId,
        r.key,
        r.value,
        r.schemaVersion,
        r.hlc.wallTimeMs,
        r.hlc.counter,
        r.deviceId,
        Number(r.isDeleted),
      );
    }
  }
  db.exec(
    "CREATE TABLE IF NOT EXISTS sync_migration (id INTEGER PRIMARY KEY, version INTEGER NOT NULL); INSERT INTO sync_migration VALUES(1,2)",
  );
})();
const integrity = db.query("PRAGMA integrity_check").all();
const foreignKeys = db.query("PRAGMA foreign_key_check").all();
if (
  JSON.stringify(integrity) !== '[{"integrity_check":"ok"}]' ||
  foreignKeys.length
)
  throw Error("Validation failed");
const actual = Number(db.query("SELECT count(*) n FROM sync_records").get().n);
if (actual !== seq) throw Error("Count mismatch");
// SQL contains only new tables/records, for applying to an existing LOCAL legacy snapshot.
const sql = [SYNC_D1_SCHEMA_SQL];
const quote = (v: unknown) =>
  typeof v === "number"
    ? String(v)
    : "'" + String(v).replaceAll("'", "''") + "'";
for (const r of db
  .query("SELECT * FROM sync_records ORDER BY server_seq")
  .all()) {
  const fields = [
    "server_seq",
    "user_id",
    "key",
    "value",
    "schema_version",
    "hlc_wall_time_ms",
    "hlc_counter",
    "device_id",
    "is_deleted",
  ];
  sql.push(
    `INSERT INTO sync_records(${fields.join(",")}) VALUES(${fields.map((f) => quote(r[f])).join(",")});`,
  );
}
sql.push(
  "CREATE TABLE IF NOT EXISTS sync_migration (id INTEGER PRIMARY KEY, version INTEGER NOT NULL); INSERT INTO sync_migration VALUES(1,2);",
);
writeFileSync(target + ".sql", sql.join("\n"), { mode: 0o600 });
db.close();
const manifest = {
  sourceSha256: createHash("sha256")
    .update(new Uint8Array(await Bun.file(source).arrayBuffer()))
    .digest("hex"),
  schema: 2,
  fsrs: "5.4.2",
  records: seq,
  counts,
  integrity: "ok",
  foreignKeys: 0,
  clientPolicy: "Discard legacy client state; bootstrap from seeded server",
  learningStepsBackfill: 0,
};
writeFileSync(target + ".manifest.json", JSON.stringify(manifest, null, 2), {
  mode: 0o600,
});
renameSync(temporary, target);
console.log(manifest);
