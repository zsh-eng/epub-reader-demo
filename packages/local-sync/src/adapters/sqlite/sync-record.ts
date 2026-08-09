import {
  type HybridLogicalTimestamp,
  type JsonValue,
  type SyncPayload,
  type SyncRecord,
  type SyncTablePolicy,
} from "../../core/index.js";
import type { SyncSchemaMetadata, TableMetadata } from "../../schema/index.js";

export function getSyncedTable(
  schema: SyncSchemaMetadata,
  tableName: string,
): TableMetadata {
  const table = schema.tables[tableName];
  if (table === undefined) {
    throw new Error(`Unknown sync table: ${tableName}`);
  }
  if (table.sync === undefined) {
    throw new Error(`Table is local-only and cannot be synced: ${tableName}`);
  }
  return table;
}

export function normalizeSyncPayload(
  tableName: string,
  table: TableMetadata,
  row: unknown,
): SyncPayload {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new Error(`Row for ${tableName} must be an object`);
  }

  const source = row as Readonly<Record<string, unknown>>;
  for (const columnName of Object.keys(source)) {
    if (table.columns[columnName] === undefined) {
      throw new Error(`Unknown column for ${tableName}: ${columnName}`);
    }
  }

  const payload: Record<string, JsonValue> = {};
  for (const [columnName, column] of Object.entries(table.columns)) {
    if (!Object.hasOwn(source, columnName)) {
      throw new Error(`Missing column for ${tableName}: ${columnName}`);
    }

    const value = source[columnName];
    if (value === null) {
      if (!column.nullable) {
        throw new Error(`Column ${tableName}.${columnName} cannot be null`);
      }
      payload[columnName] = null;
      continue;
    }

    if (column.kind === "text" || column.kind === "json-text") {
      if (typeof value !== "string") {
        throw new Error(`Column ${tableName}.${columnName} must be text`);
      }
      if (column.kind === "json-text") {
        assertJsonText(value, `${tableName}.${columnName}`);
      }
      payload[columnName] = value;
      continue;
    }

    if (typeof value !== "number") {
      throw new Error(`Column ${tableName}.${columnName} must be a number`);
    }
    if (column.kind === "integer" && !Number.isSafeInteger(value)) {
      throw new Error(
        `Column ${tableName}.${columnName} must be a safe integer`,
      );
    }
    if (column.kind === "real" && !Number.isFinite(value)) {
      throw new Error(`Column ${tableName}.${columnName} must be finite`);
    }
    payload[columnName] = value;
  }

  const normalized = Object.freeze(payload);
  assertNonEmpty(getRecordId(table, normalized), `${tableName} record ID`);
  const scopeId = getScopeId(table, normalized);
  if (scopeId !== undefined) {
    assertNonEmpty(scopeId, `${tableName} scope ID`);
  }
  return normalized;
}

export function createLocalSyncRecord(
  tableName: string,
  table: TableMetadata,
  payload: SyncPayload,
  hlc: HybridLogicalTimestamp,
  deviceId: string,
  operation: "put" | "delete",
): SyncRecord<SyncPayload> {
  const sync = getSyncPolicy(table);
  const scopeId = getScopeId(table, payload);
  const base = {
    tableName,
    recordId: getRecordId(table, payload),
    ...(scopeId === undefined ? {} : { scopeId }),
    hlc,
    deviceId,
    schemaVersion: sync.schemaVersion,
    payload,
  };

  return operation === "put"
    ? { ...base, operation: "put" }
    : { ...base, operation: "delete" };
}

export function getRecordId(
  table: TableMetadata,
  payload: SyncPayload,
): string {
  const value = payload[getSyncPolicy(table).recordId];
  if (typeof value !== "string") {
    throw new Error("Synced record ID must be text");
  }
  return value;
}

export function assertUniqueRecordIds(
  tableName: string,
  table: TableMetadata,
  payloads: readonly SyncPayload[],
): void {
  assertUniqueStrings(
    payloads.map((payload) => getRecordId(table, payload)),
    `put batch for ${tableName}`,
  );
}

export function assertUniqueStrings(
  values: readonly string[],
  field: string,
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`${field} contains duplicate record ID: ${value}`);
    }
    seen.add(value);
  }
}

export function assertNonEmpty(value: string, field: string): void {
  if (value.length === 0) {
    throw new Error(`${field} must not be empty`);
  }
}

export function assertNonNegativeSafeInteger(
  value: number,
  field: string,
): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
}

export function columnList(table: TableMetadata): string {
  return Object.keys(table.columns).map(quoteIdentifier).join(", ");
}

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function recordKey(tableName: string, recordId: string): string {
  return JSON.stringify([tableName, recordId]);
}

function getScopeId(
  table: TableMetadata,
  payload: SyncPayload,
): string | undefined {
  const scopeColumn = getSyncPolicy(table).scopeId;
  if (scopeColumn === undefined) {
    return undefined;
  }

  const value = payload[scopeColumn];
  if (typeof value !== "string") {
    throw new Error("Synced scope ID must be text");
  }
  return value;
}

function getSyncPolicy(table: TableMetadata): SyncTablePolicy {
  const sync = table.sync;
  if (sync === undefined) {
    throw new Error("Expected a synced table policy");
  }
  return sync;
}

function assertJsonText(value: string, field: string): void {
  try {
    JSON.parse(value);
  } catch {
    throw new Error(`Column ${field} must contain valid JSON`);
  }
}
