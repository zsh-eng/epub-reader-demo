#!/usr/bin/env bun

import { Database, type SQLQueryBindings } from "bun:sqlite";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { basename, join, resolve } from "node:path";

interface CliOptions {
  database: string;
  databaseId: string;
  outputDirectory: string;
  pageSize: number;
}

interface RemoteQueryResult {
  results: Record<string, RemoteValue>[];
  success: boolean;
  meta: {
    size_after?: number;
  };
}

interface SchemaObject {
  type: "index" | "table" | "trigger" | "view";
  name: string;
  sql: string;
}

interface TableBackupResult {
  name: string;
  rows: number;
}

type RemoteValue = null | boolean | number | string | number[];

const DEFAULT_PAGE_SIZE = 2_000;
const SAFE_NAME = /^[A-Za-z0-9_-]+$/;
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SCHEMA_SQL = `
  SELECT type, name, sql
  FROM sqlite_schema
  WHERE type IN ('table', 'index', 'trigger', 'view')
    AND name NOT GLOB 'sqlite_*'
    AND name NOT GLOB '_cf_*'
    AND sql IS NOT NULL
  ORDER BY CASE type
    WHEN 'table' THEN 1
    WHEN 'index' THEN 2
    WHEN 'view' THEN 3
    WHEN 'trigger' THEN 4
  END, name
`;

/**
 * Creates a verified logical snapshot without exposing D1 row values to the
 * terminal. Cloudflare-managed internal tables are outside this backup.
 */
async function main(): Promise<void> {
  const options = parseArgs(Bun.argv.slice(2));
  await mkdir(options.outputDirectory, { recursive: true, mode: 0o700 });

  const sqlitePath = join(
    options.outputDirectory,
    `${options.database}.sqlite`,
  );
  const partialPath = `${sqlitePath}.partial`;
  const manifestPath = join(options.outputDirectory, "manifest.json");
  await refuseExistingPaths([sqlitePath, partialPath, manifestPath]);

  const createdAt = new Date().toISOString();
  const schemaQuery = await queryRemote(options.database, SCHEMA_SQL);
  const schemaObjects = parseSchemaObjects(schemaQuery.results);
  const tables = schemaObjects.filter((object) => object.type === "table");
  const deferredObjects = schemaObjects.filter(
    (object) => object.type !== "table",
  );
  const database = new Database(partialPath, { create: true, strict: true });
  const tableResults: TableBackupResult[] = [];

  try {
    database.exec("PRAGMA foreign_keys = OFF");
    for (const table of tables) {
      database.exec(table.sql);
    }

    for (const table of tables) {
      const result = await copyTable(
        options.database,
        database,
        table.name,
        options.pageSize,
      );
      tableResults.push(result);
    }

    for (const object of deferredObjects) {
      database.exec(object.sql);
    }

    verifyLocalDatabase(database, tableResults);
    database.exec("PRAGMA optimize");
  } catch (error) {
    database.close();
    await rm(partialPath, { force: true });
    throw error;
  }

  database.close();
  await rename(partialPath, sqlitePath);

  const sqliteStats = await stat(sqlitePath);
  const sqliteSha256 = await sha256File(sqlitePath);
  const manifest = {
    format: "logical-d1-query-backup-v1",
    createdAt,
    source: {
      databaseName: options.database,
      databaseId: options.databaseId,
      remoteSizeBytes: schemaQuery.meta.size_after ?? null,
    },
    backup: {
      sqliteFile: basename(sqlitePath),
      sqliteBytes: sqliteStats.size,
      sqliteSha256,
      pageSize: options.pageSize,
    },
    verification: {
      integrityCheck: "ok",
      foreignKeyViolations: 0,
      tables: tableResults,
      totalRows: tableResults.reduce((sum, table) => sum + table.rows, 0),
      schemaObjects: schemaObjects.length,
    },
    exclusions: [
      {
        name: "_cf_KV",
        reason:
          "Cloudflare-managed internal table. D1 rejects direct reads of its value column.",
      },
    ],
  };

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  await chmod(sqlitePath, 0o400);
  await chmod(manifestPath, 0o400);

  console.log(`Backup complete: ${sqlitePath}`);
  console.log(`Manifest: ${manifestPath}`);
  console.log(
    `Copied ${manifest.verification.totalRows} rows from ${tables.length} tables.`,
  );
  console.log(`SHA-256: ${sqliteSha256}`);
}

/** Copies one ordinary rowid table in bounded, transactional pages. */
async function copyTable(
  remoteDatabase: string,
  localDatabase: Database,
  tableName: string,
  pageSize: number,
): Promise<TableBackupResult> {
  assertIdentifier(tableName);
  const quotedTable = quoteIdentifier(tableName);
  const columnsResult = await queryRemote(
    remoteDatabase,
    `PRAGMA table_info(${quotedTable})`,
  );
  const columns = columnsResult.results.map((row) => {
    if (typeof row.name !== "string") {
      throw new Error(`D1 returned an invalid column for table ${tableName}`);
    }
    assertIdentifier(row.name);
    return row.name;
  });

  if (columns.length === 0) {
    throw new Error(`D1 returned no columns for table ${tableName}`);
  }

  const quotedColumns = columns.map(quoteIdentifier).join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  const insert = localDatabase.prepare(
    `INSERT INTO ${quotedTable} (${quotedColumns}) VALUES (${placeholders})`,
  );
  const insertPage = localDatabase.transaction(
    (rows: Record<string, RemoteValue>[]) => {
      for (const row of rows) {
        insert.run(...columns.map((column) => toSqliteValue(row[column])));
      }
    },
  );

  let lastRowId = 0;
  let copiedRows = 0;
  console.log(`Copying ${tableName}...`);

  while (true) {
    const page = await queryRemote(
      remoteDatabase,
      `SELECT rowid AS __backup_rowid, ${quotedColumns}
       FROM ${quotedTable}
       WHERE rowid > ${lastRowId}
       ORDER BY rowid
       LIMIT ${pageSize}`,
    );
    if (page.results.length === 0) break;

    insertPage(page.results);
    const finalRowId = page.results.at(-1)?.__backup_rowid;
    if (typeof finalRowId !== "number" || finalRowId <= lastRowId) {
      throw new Error(`D1 returned an invalid rowid for table ${tableName}`);
    }
    lastRowId = finalRowId;
    copiedRows += page.results.length;
    console.log(`  ${copiedRows} rows`);
  }

  return { name: tableName, rows: copiedRows };
}

function verifyLocalDatabase(
  database: Database,
  expectedTables: readonly TableBackupResult[],
): void {
  for (const table of expectedTables) {
    const row = database
      .query<{ count: number }, []>(
        `SELECT count(*) AS count FROM ${quoteIdentifier(table.name)}`,
      )
      .get();
    if (row?.count !== table.rows) {
      throw new Error(
        `Local row count mismatch for ${table.name}: expected ${table.rows}, got ${row?.count ?? "no result"}`,
      );
    }
  }

  const integrity = database
    .query<{ integrity_check: string }, []>("PRAGMA integrity_check")
    .get();
  if (integrity?.integrity_check !== "ok") {
    throw new Error(
      `Local SQLite integrity check failed: ${integrity?.integrity_check ?? "no result"}`,
    );
  }

  const foreignKeyViolation = database
    .query<Record<string, unknown>, []>("PRAGMA foreign_key_check")
    .get();
  if (foreignKeyViolation !== null) {
    throw new Error("Local SQLite foreign-key check failed");
  }
}

async function queryRemote(
  database: string,
  sql: string,
): Promise<RemoteQueryResult> {
  const process = Bun.spawn(
    [
      "bunx",
      "wrangler",
      "d1",
      "execute",
      database,
      "--remote",
      "--command",
      sql,
      "--json",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(
      `Wrangler D1 query failed${stderr.trim() === "" ? "" : `: ${stderr.trim()}`}`,
    );
  }

  const parsed = JSON.parse(stdout) as unknown;
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error("Wrangler returned an unexpected D1 response envelope");
  }
  const result = parsed[0] as RemoteQueryResult;
  if (result.success !== true || !Array.isArray(result.results)) {
    throw new Error("Wrangler returned an unsuccessful D1 query result");
  }
  return result;
}

function parseSchemaObjects(
  rows: readonly Record<string, RemoteValue>[],
): SchemaObject[] {
  return rows.map((row) => {
    if (
      (row.type !== "table" &&
        row.type !== "index" &&
        row.type !== "trigger" &&
        row.type !== "view") ||
      typeof row.name !== "string" ||
      typeof row.sql !== "string"
    ) {
      throw new Error("D1 returned an invalid schema object");
    }
    assertIdentifier(row.name);
    return { type: row.type, name: row.name, sql: row.sql };
  });
}

function toSqliteValue(value: RemoteValue | undefined): SQLQueryBindings {
  if (value === undefined) {
    throw new Error("D1 omitted a selected column from a result row");
  }
  if (Array.isArray(value)) return Uint8Array.from(value);
  return value;
}

function quoteIdentifier(identifier: string): string {
  assertIdentifier(identifier);
  return `"${identifier}"`;
}

function assertIdentifier(identifier: string): void {
  if (!SAFE_IDENTIFIER.test(identifier)) {
    throw new Error(`Unsafe SQLite identifier: ${identifier}`);
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function refuseExistingPaths(paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    try {
      await access(path);
      throw new Error(`Refusing to replace existing backup artifact: ${path}`);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        continue;
      }
      throw error;
    }
  }
}

function parseArgs(args: string[]): CliOptions {
  let database: string | undefined;
  let databaseId: string | undefined;
  let outputDirectory: string | undefined;
  let pageSize = DEFAULT_PAGE_SIZE;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--database") {
      database = requireValue(args, ++index, argument);
      continue;
    }
    if (argument === "--database-id") {
      databaseId = requireValue(args, ++index, argument);
      continue;
    }
    if (argument === "--output-dir") {
      outputDirectory = requireValue(args, ++index, argument);
      continue;
    }
    if (argument === "--page-size") {
      pageSize = Number(requireValue(args, ++index, argument));
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (database === undefined || !SAFE_NAME.test(database)) {
    throw new Error("--database must be a safe D1 database name");
  }
  if (databaseId === undefined || !SAFE_NAME.test(databaseId)) {
    throw new Error("--database-id must be a safe D1 database ID");
  }
  if (outputDirectory === undefined) {
    throw new Error("--output-dir is required");
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 5_000) {
    throw new Error("--page-size must be an integer from 1 through 5000");
  }

  return {
    database,
    databaseId,
    outputDirectory: resolve(outputDirectory),
    pageSize,
  };
}

function requireValue(
  args: readonly string[],
  index: number,
  option: string,
): string {
  const value = args[index];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function printHelp(): void {
  console.log(`Usage:
  bun scripts/backup-remote-d1.ts --database <name> --database-id <uuid> --output-dir <directory> [--page-size <1-5000>]

Creates a local SQLite backup of every application-owned D1 table. The command
uses read-only Wrangler queries, never prints row values, refuses to overwrite
artifacts, verifies row counts and SQLite integrity, and writes a manifest.`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
