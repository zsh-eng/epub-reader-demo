import {
  encodeSyncKey,
  encodeSyncValue,
  syncDeviceIdSchema,
  syncHlcSchema,
} from "../../src/lib/sync-v2/protocol";

export const SYNC_V2_MIGRATION_SCHEMA_VERSION = 1;

const MIGRATED_TABLES = new Set([
  "books",
  "readingProgress",
  "readingCheckpoints",
  "readingSessions",
  "highlights",
  "readingSettings",
  "readingState",
  "notes",
]);

const LEGACY_METADATA_FIELDS = new Set([
  "_hlc",
  "_deviceId",
  "_isDeleted",
  "_serverTimestamp",
  "_deleted",
]);

export interface LegacySyncDataRow {
  id: string;
  table_name: string;
  user_id: string;
  hlc: string;
  device_id: string;
  is_deleted: number | boolean;
  data: string | Record<string, unknown>;
}

export interface SyncV2SeedRecord {
  userId: string;
  key: string;
  value: string;
  schemaVersion: number;
  hlc: {
    wallTimeMs: number;
    counter: number;
  };
  deviceId: string;
  isDeleted: boolean;
}

export interface SyncV2MigrationTableReport {
  tableName: string;
  totalRows: number;
  activeRows: number;
  deletedRows: number;
}

export interface SyncV2MigrationUserReport {
  userId: string;
  totalRows: number;
  activeRows: number;
  deletedRows: number;
  tables: SyncV2MigrationTableReport[];
}

export interface SyncV2MigrationReport {
  schemaVersion: number;
  totalRows: number;
  activeRows: number;
  deletedRows: number;
  hlcDeviceMismatches: number;
  users: SyncV2MigrationUserReport[];
}

export interface SyncV2MigrationResult {
  records: SyncV2SeedRecord[];
  report: SyncV2MigrationReport;
}

export interface ParsedLegacyHlc {
  wallTimeMs: number;
  counter: number;
  deviceId: string;
}

interface MutableTableReport {
  totalRows: number;
  activeRows: number;
  deletedRows: number;
}

interface MutableUserReport extends MutableTableReport {
  tables: Map<string, MutableTableReport>;
}

/**
 * Converts the compacted winners in the old `sync_data` table into the v2
 * opaque-key format. The result order is stable for repeatable review and seed
 * files.
 */
export function migrateLegacySyncRows(
  rows: readonly LegacySyncDataRow[],
): SyncV2MigrationResult {
  const records: SyncV2SeedRecord[] = [];
  const logicalKeys = new Set<string>();
  const users = new Map<string, MutableUserReport>();
  let activeRows = 0;
  let deletedRows = 0;
  let hlcDeviceMismatches = 0;

  for (const rawRow of rows) {
    const row = validateLegacyRow(rawRow);
    const parsedHlc = withRowContext(row, () => parseLegacyHlc(row.hlc));
    const isDeleted = withRowContext(row, () =>
      parseLegacyDeletion(row.is_deleted),
    );
    const key = withRowContext(row, () =>
      encodeSyncKey(row.table_name, row.id),
    );
    const logicalKey = JSON.stringify([row.user_id, key]);

    if (logicalKeys.has(logicalKey)) {
      throw migrationError(row, "duplicate user and logical key");
    }
    logicalKeys.add(logicalKey);

    const deviceId = withRowContext(row, () =>
      syncDeviceIdSchema.parse(row.device_id),
    );
    const value = withRowContext(row, () =>
      encodeSyncValue(migrateDomainValue(row, isDeleted, deviceId)),
    );

    records.push({
      userId: row.user_id,
      key,
      value,
      schemaVersion: SYNC_V2_MIGRATION_SCHEMA_VERSION,
      hlc: syncHlcSchema.parse({
        wallTimeMs: parsedHlc.wallTimeMs,
        counter: parsedHlc.counter,
      }),
      deviceId,
      isDeleted,
    });

    if (parsedHlc.deviceId !== deviceId) hlcDeviceMismatches += 1;
    if (isDeleted) deletedRows += 1;
    else activeRows += 1;
    addReportRow(users, row.user_id, row.table_name, isDeleted);
  }

  records.sort(compareSeedRecords);

  return {
    records,
    report: {
      schemaVersion: SYNC_V2_MIGRATION_SCHEMA_VERSION,
      totalRows: records.length,
      activeRows,
      deletedRows,
      hlcDeviceMismatches,
      users: finalizeUserReports(users),
    },
  };
}

/** Creates a deterministic D1 seed artifact for direct review and import. */
export function createSyncV2SeedSql(
  records: readonly SyncV2SeedRecord[],
): string {
  const sortedRecords = [...records].sort(compareSeedRecords);
  const statements = sortedRecords.map((record) => {
    const deletion = record.isDeleted ? 1 : 0;

    return (
      "INSERT INTO sync_records " +
      "(user_id, key, value, schema_version, hlc_wall_time_ms, hlc_counter, device_id, is_deleted) " +
      `VALUES (${sqlText(record.userId)}, ${sqlText(record.key)}, ${sqlText(record.value)}, ` +
      `${record.schemaVersion}, ${record.hlc.wallTimeMs}, ${record.hlc.counter}, ` +
      `${sqlText(record.deviceId)}, ${deletion});`
    );
  });

  return [...statements, ""].join("\n");
}

export function parseLegacyHlc(hlc: string): ParsedLegacyHlc {
  const firstSeparator = hlc.indexOf("-");
  const secondSeparator = hlc.indexOf("-", firstSeparator + 1);
  if (firstSeparator <= 0 || secondSeparator <= firstSeparator + 1) {
    throw new Error(`Invalid legacy HLC: ${hlc}`);
  }

  const wallTimeText = hlc.slice(0, firstSeparator);
  const counterText = hlc.slice(firstSeparator + 1, secondSeparator);
  const deviceId = hlc.slice(secondSeparator + 1);
  if (
    !/^(0|[1-9]\d*)$/.test(wallTimeText) ||
    !/^(0|[1-9]\d*)$/.test(counterText) ||
    deviceId.length === 0
  ) {
    throw new Error(`Invalid legacy HLC: ${hlc}`);
  }

  const parsed = syncHlcSchema.parse({
    wallTimeMs: Number(wallTimeText),
    counter: Number(counterText),
  });
  return { ...parsed, deviceId };
}

function validateLegacyRow(row: LegacySyncDataRow): LegacySyncDataRow {
  for (const [name, value] of [
    ["id", row.id],
    ["table_name", row.table_name],
    ["user_id", row.user_id],
    ["hlc", row.hlc],
    ["device_id", row.device_id],
  ] as const) {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`Legacy sync row has invalid ${name}`);
    }
  }

  if (!MIGRATED_TABLES.has(row.table_name)) {
    throw migrationError(row, `unknown table ${row.table_name}`);
  }
  if (
    row.user_id.includes("\u0000") ||
    row.user_id.includes("\r") ||
    row.user_id.includes("\n")
  ) {
    throw migrationError(row, "user_id contains a control line break");
  }

  return row;
}

function parseLegacyDeletion(value: number | boolean): boolean {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  throw new Error(`Invalid legacy deletion value: ${String(value)}`);
}

function migrateDomainValue(
  row: LegacySyncDataRow,
  isDeleted: boolean,
  deviceId: string,
): Record<string, unknown> {
  const data = parseLegacyData(row);
  const domainData = Object.fromEntries(
    Object.entries(data).filter(
      ([field]) =>
        field !== "id" &&
        field !== "isDeleted" &&
        !LEGACY_METADATA_FIELDS.has(field),
    ),
  );

  if (row.table_name === "readingProgress") {
    domainData.deviceId = deviceId;
  }

  return { id: row.id, ...domainData, isDeleted };
}

function parseLegacyData(row: LegacySyncDataRow): Record<string, unknown> {
  let parsed: unknown = row.data;
  if (typeof row.data === "string") {
    try {
      parsed = JSON.parse(row.data) as unknown;
    } catch {
      throw migrationError(row, "data is not valid JSON");
    }
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw migrationError(row, "data must be a JSON object");
  }

  return parsed as Record<string, unknown>;
}

function addReportRow(
  users: Map<string, MutableUserReport>,
  userId: string,
  tableName: string,
  isDeleted: boolean,
): void {
  const user = users.get(userId) ?? {
    totalRows: 0,
    activeRows: 0,
    deletedRows: 0,
    tables: new Map<string, MutableTableReport>(),
  };
  const table = user.tables.get(tableName) ?? {
    totalRows: 0,
    activeRows: 0,
    deletedRows: 0,
  };

  user.totalRows += 1;
  table.totalRows += 1;
  if (isDeleted) {
    user.deletedRows += 1;
    table.deletedRows += 1;
  } else {
    user.activeRows += 1;
    table.activeRows += 1;
  }

  user.tables.set(tableName, table);
  users.set(userId, user);
}

function finalizeUserReports(
  users: Map<string, MutableUserReport>,
): SyncV2MigrationUserReport[] {
  return Array.from(users, ([userId, user]) => ({
    userId,
    totalRows: user.totalRows,
    activeRows: user.activeRows,
    deletedRows: user.deletedRows,
    tables: Array.from(user.tables, ([tableName, table]) => ({
      tableName,
      ...table,
    })).sort((left, right) => left.tableName.localeCompare(right.tableName)),
  })).sort((left, right) => left.userId.localeCompare(right.userId));
}

function compareSeedRecords(
  left: SyncV2SeedRecord,
  right: SyncV2SeedRecord,
): number {
  const userCompare = left.userId.localeCompare(right.userId);
  if (userCompare !== 0) return userCompare;
  return left.key.localeCompare(right.key);
}

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function migrationError(row: LegacySyncDataRow, message: string): Error {
  return new Error(
    `Cannot migrate ${row.table_name || "<unknown>"}/${row.id || "<unknown>"}: ${message}`,
  );
}

function withRowContext<Value>(
  row: LegacySyncDataRow,
  operation: () => Value,
): Value {
  try {
    return operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw migrationError(row, message);
  }
}
