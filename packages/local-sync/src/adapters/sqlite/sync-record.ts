import { z } from "zod";
import {
  type HybridLogicalTimestamp,
  type JsonValue,
  type SyncPayload,
  type SyncRecord,
  type SyncTablePolicy,
} from "../../core/index.js";
import type { SyncSchemaMetadata, TableMetadata } from "../../schema/index.js";

export type SyncedTableMetadata = TableMetadata & {
  readonly sync: SyncTablePolicy;
};

const remotePayloadSchemas = new WeakMap<
  TableMetadata,
  z.ZodType<SyncPayload>
>();

export function getSyncedTable(
  schema: SyncSchemaMetadata,
  tableName: string,
): SyncedTableMetadata {
  const table = schema.tables[tableName];
  if (table === undefined) {
    throw new Error(`Unknown sync table: ${tableName}`);
  }
  if (table.sync === undefined) {
    throw new Error(`Table is local-only and cannot be synced: ${tableName}`);
  }
  return table as SyncedTableMetadata;
}

/** Selects only declared columns from an application-owned typed row. */
export function projectSyncPayload(
  table: TableMetadata,
  row: unknown,
): SyncPayload {
  const source = row as Readonly<Record<string, unknown>>;
  const payload: Record<string, JsonValue> = {};
  for (const columnName of Object.keys(table.columns)) {
    payload[columnName] = source[columnName] as JsonValue;
  }
  return Object.freeze(payload);
}

/** Parses an untrusted remote payload against its application table schema. */
export function parseRemoteSyncPayload(
  table: SyncedTableMetadata,
  input: unknown,
): SyncPayload {
  let schema = remotePayloadSchemas.get(table);
  if (schema === undefined) {
    schema = createRemotePayloadSchema(table);
    remotePayloadSchemas.set(table, schema);
  }
  return schema.parse(input);
}

export function createLocalSyncRecord(
  tableName: string,
  table: SyncedTableMetadata,
  payload: SyncPayload,
  hlc: HybridLogicalTimestamp,
  deviceId: string,
  operation: "put" | "delete",
): SyncRecord<SyncPayload> {
  const scopeId = getScopeId(table, payload);
  const base = {
    tableName,
    recordId: getRecordId(table, payload),
    ...(scopeId === undefined ? {} : { scopeId }),
    hlc,
    deviceId,
    schemaVersion: table.sync.schemaVersion,
    payload,
  };

  return operation === "put"
    ? { ...base, operation: "put" }
    : { ...base, operation: "delete" };
}

export function getRecordId(
  table: SyncedTableMetadata,
  payload: SyncPayload,
): string {
  return payload[table.sync.recordId] as string;
}

export function assertUniqueRecordIds(
  tableName: string,
  table: SyncedTableMetadata,
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

export function columnList(table: TableMetadata): string {
  return Object.keys(table.columns).map(quoteIdentifier).join(", ");
}

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function recordKey(tableName: string, recordId: string): string {
  return JSON.stringify([tableName, recordId]);
}

export function getScopeId(
  table: SyncedTableMetadata,
  payload: SyncPayload,
): string | undefined {
  const scopeColumn = table.sync.scopeId;
  if (scopeColumn === undefined) {
    return undefined;
  }

  return payload[scopeColumn] as string;
}

function createRemotePayloadSchema(
  table: TableMetadata,
): z.ZodType<SyncPayload> {
  const shape: Record<string, z.ZodType> = {};
  for (const [columnName, column] of Object.entries(table.columns)) {
    let schema: z.ZodType;
    if (column.kind === "integer") {
      schema = z.int();
    } else if (column.kind === "real") {
      schema = z.number();
    } else if (column.kind === "json-text") {
      schema = z.string().refine(isJsonText, "Invalid JSON text");
    } else {
      schema = z.string();
    }
    shape[columnName] = column.nullable ? schema.nullable() : schema;
  }

  return z
    .strictObject(shape)
    .transform((payload) => Object.freeze(payload) as SyncPayload);
}

function isJsonText(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}
