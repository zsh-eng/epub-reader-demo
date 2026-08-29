#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createSyncV2RepairSql,
  createSyncV2SeedSql,
  migrateLegacySyncRows,
  type LegacySyncDataRow,
} from "./lib/sync-v2-migration";

interface CliOptions {
  inputPath: string;
  outputPath?: string;
  reportPath?: string;
  dryRun: boolean;
  force: boolean;
  replaceExisting: boolean;
}

const LEGACY_ROWS_SQL = `
  SELECT
    id,
    table_name,
    user_id,
    entity_id,
    hlc,
    device_id,
    is_deleted,
    data
  FROM sync_data
  ORDER BY user_id, table_name, id
`;

async function main(): Promise<void> {
  const options = parseArgs(Bun.argv.slice(2));
  const legacyRows = await loadLegacyRows(options.inputPath);
  const result = migrateLegacySyncRows(legacyRows);
  const reportJson = `${JSON.stringify(result.report, null, 2)}\n`;

  if (options.dryRun) {
    process.stdout.write(reportJson);
    return;
  }

  const outputPath = options.outputPath!;
  const reportPath = options.reportPath ?? `${outputPath}.report.json`;
  await validateOutputPaths(
    options.inputPath,
    [outputPath, reportPath],
    options.force,
  );

  const outputSql = options.replaceExisting
    ? createSyncV2RepairSql(result.records)
    : createSyncV2SeedSql(result.records);
  await writeFile(outputPath, outputSql, "utf8");
  await writeFile(reportPath, reportJson, "utf8");
  console.log(`Wrote ${result.records.length} rows to ${outputPath}`);
  console.log(`Wrote the verification report to ${reportPath}`);
}

function parseArgs(args: string[]): CliOptions {
  let inputPath: string | undefined;
  let outputPath: string | undefined;
  let reportPath: string | undefined;
  let dryRun = false;
  let force = false;
  let replaceExisting = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--input") {
      inputPath = requireValue(args, ++index, argument);
      continue;
    }
    if (argument === "--output") {
      outputPath = requireValue(args, ++index, argument);
      continue;
    }
    if (argument === "--report") {
      reportPath = requireValue(args, ++index, argument);
      continue;
    }
    if (argument === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (argument === "--force") {
      force = true;
      continue;
    }
    if (argument === "--replace-existing") {
      replaceExisting = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (inputPath === undefined) {
    throw new Error("--input is required");
  }
  if (!dryRun && outputPath === undefined) {
    throw new Error("--output is required unless --dry-run is set");
  }
  if (dryRun && (outputPath !== undefined || reportPath !== undefined)) {
    throw new Error("--dry-run does not write --output or --report files");
  }
  if (dryRun && replaceExisting) {
    throw new Error("--replace-existing requires a SQL output");
  }

  return {
    inputPath: resolve(inputPath),
    ...(outputPath === undefined ? {} : { outputPath: resolve(outputPath) }),
    ...(reportPath === undefined ? {} : { reportPath: resolve(reportPath) }),
    dryRun,
    force,
    replaceExisting,
  };
}

async function loadLegacyRows(inputPath: string): Promise<LegacySyncDataRow[]> {
  const input = await readFile(inputPath);
  const isSqliteDatabase =
    input.subarray(0, 16).toString("utf8") === "SQLite format 3\u0000";
  const database = isSqliteDatabase
    ? new Database(inputPath, { readonly: true, strict: true })
    : new Database(":memory:", { strict: true });

  try {
    if (!isSqliteDatabase) database.exec(input.toString("utf8"));
    const table = database
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sync_data'",
      )
      .get();
    if (table === null) {
      throw new Error("Input SQL does not contain the sync_data table");
    }

    return database.query<LegacySyncDataRow, []>(LEGACY_ROWS_SQL).all();
  } finally {
    database.close();
  }
}

async function validateOutputPaths(
  inputPath: string,
  outputPaths: readonly string[],
  force: boolean,
): Promise<void> {
  const resolvedInput = resolve(inputPath);
  const uniqueOutputs = new Set(outputPaths.map((path) => resolve(path)));
  if (uniqueOutputs.size !== outputPaths.length) {
    throw new Error("Output and report paths must be different");
  }

  for (const outputPath of uniqueOutputs) {
    if (outputPath === resolvedInput) {
      throw new Error("An output path cannot replace the input export");
    }
    if (!force && (await pathExists(outputPath))) {
      throw new Error(`Output already exists: ${outputPath}`);
    }
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
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
  bun scripts/migrate-sync-v2.ts --input <d1-export.sql|backup.sqlite> --dry-run
  bun scripts/migrate-sync-v2.ts --input <d1-export.sql|backup.sqlite> --output <seed.sql> [--report <report.json>] [--force] [--replace-existing]

The input must be a Wrangler D1 SQL export or SQLite backup that contains sync_data.
Dry-run prints a count-only verification report and writes no files.
--replace-existing emits a repair seed that advances server sequences.`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
