/** Export only converted application tables for import into an empty, migrated D1. */
import { Database } from "bun:sqlite";
import { createWriteStream, existsSync } from "node:fs";
import { once } from "node:events";
const [input, output] = process.argv.slice(2);
if (!input || !output)
  throw Error(
    "Usage: bun scripts/backend-migration/export-sql.ts converted.sqlite new-seed.sql",
  );
if (existsSync(output)) throw Error("Output already exists");
const db = new Database(input, { readonly: true });
const stream = createWriteStream(output, { flags: "wx", mode: 0o600 });
const quote = (value: unknown) =>
  value === null
    ? "NULL"
    : typeof value === "number"
      ? String(value)
      : "'" + String(value).replaceAll("'", "''") + "'";
async function write(text: string) {
  if (!stream.write(text)) await once(stream, "drain");
}
await write("PRAGMA defer_foreign_keys = ON;\n");
for (const table of ["user", "account", "file_storage", "sync_records"]) {
  for (const row of db.query(`SELECT * FROM "${table}"`).iterate() as Iterable<
    Record<string, unknown>
  >) {
    await write(
      `INSERT INTO "${table}" (${Object.keys(row)
        .map((k) => '"' + k + '"')
        .join(",")}) VALUES (${Object.values(row).map(quote).join(",")});\n`,
    );
  }
}
stream.end();
await once(stream, "finish");
db.close();
console.log("Export complete");
