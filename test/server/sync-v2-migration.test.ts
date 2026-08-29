import {
  createSyncV2SeedSql,
  migrateLegacySyncRows,
  type LegacySyncDataRow,
} from "../../scripts/lib/sync-v2-migration";
import { decodeSyncValue, encodeSyncKey } from "@/lib/sync-v2/protocol";
import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestUser } from "./helpers";

describe("sync v2 production-data migration", () => {
  let userId: string;

  beforeAll(async () => {
    const testUser = await createTestUser(
      "sync-v2-migration@example.com",
      "testpassword123",
      "Sync V2 Migration User",
    );
    userId = testUser.userId;
  });

  beforeEach(async () => {
    await env.DATABASE.prepare("DELETE FROM sync_data WHERE user_id = ?")
      .bind(userId)
      .run();
    await env.DATABASE.prepare("DELETE FROM sync_records WHERE user_id = ?")
      .bind(userId)
      .run();
  });

  it("transforms the old D1 rows and applies a direct seed", async () => {
    await insertLegacyRow({
      id: "book-1",
      tableName: "books",
      userId,
      hlc: "100-2-hlc-device",
      deviceId: "writer-device",
      isDeleted: false,
      data: {
        id: "stale-id",
        title: "O'Brien",
        _hlc: "remove-me",
        _deviceId: "remove-me",
        _serverTimestamp: 99,
        _isDeleted: false,
      },
    });
    await insertLegacyRow({
      id: "progress-1",
      tableName: "readingProgress",
      userId,
      hlc: "101-0-progress-device",
      deviceId: "progress-device",
      isDeleted: true,
      data: {
        bookId: "book-1",
        currentSpineIndex: 3,
        scrollProgress: 42,
        lastRead: 101,
        createdAt: 100,
        deviceId: "stale-domain-device",
      },
    });
    await insertLegacyRow({
      id: "note-1",
      tableName: "notes",
      userId,
      hlc: "102-4-note-device",
      deviceId: "note-device",
      isDeleted: false,
      data: { bookId: "book-1", content: "A retained note" },
    });

    const legacyRows = await readLegacyRows(userId);
    const migration = migrateLegacySyncRows(legacyRows);
    const seedSql = createSyncV2SeedSql(migration.records);

    expect(migration.report).toMatchObject({
      schemaVersion: 1,
      sourceRows: 3,
      totalRows: 2,
      excludedRows: 1,
      activeRows: 2,
      deletedRows: 0,
      hlcDeviceMismatches: 1,
      exclusions: [
        {
          reason: "deprecated-reading-progress",
          tableName: "readingProgress",
          totalRows: 1,
        },
      ],
      users: [
        {
          userId,
          totalRows: 2,
          activeRows: 2,
          deletedRows: 0,
          tables: [
            {
              tableName: "books",
              totalRows: 1,
              activeRows: 1,
              deletedRows: 0,
            },
            {
              tableName: "notes",
              totalRows: 1,
              activeRows: 1,
              deletedRows: 0,
            },
          ],
        },
      ],
    });

    const book = migration.records.find(
      (record) => record.key === encodeSyncKey("books", "book-1"),
    )!;
    expect(book).toMatchObject({
      userId,
      schemaVersion: 1,
      hlc: { wallTimeMs: 100, counter: 2 },
      deviceId: "writer-device",
      isDeleted: false,
    });
    expect(decodeSyncValue(book.value)).toEqual({
      id: "book-1",
      title: "O'Brien",
      isDeleted: false,
    });

    expect(
      migration.records.find(
        (record) =>
          record.key === encodeSyncKey("readingProgress", "progress-1"),
      ),
    ).toBeUndefined();

    expect(seedSql).not.toMatch(/\b(?:DELETE|UPDATE)\b/);
    await env.DATABASE.exec(seedSql);

    const stored = await env.DATABASE.prepare(
      `SELECT key, value, schema_version, hlc_wall_time_ms,
              hlc_counter, device_id, is_deleted
       FROM sync_records
       WHERE user_id = ?
       ORDER BY key`,
    )
      .bind(userId)
      .all<{
        key: string;
        value: string;
        schema_version: number;
        hlc_wall_time_ms: number;
        hlc_counter: number;
        device_id: string;
        is_deleted: number;
      }>();

    expect(stored.results).toHaveLength(2);
    expect(
      stored.results.find(
        (row) => row.key === encodeSyncKey("books", "book-1"),
      ),
    ).toMatchObject({
      value: book.value,
      schema_version: 1,
      hlc_wall_time_ms: 100,
      hlc_counter: 2,
      device_id: "writer-device",
      is_deleted: 0,
    });
  });

  it("retains checkpoints and native sessions but excludes inferred sessions", () => {
    const checkpoint = {
      ...legacyRow(
        "checkpoint-1",
        "readingCheckpoints",
        "user-a",
        "20-0-device-a",
      ),
      data: {
        bookId: "book-1",
        deviceId: "device-a",
        lastRead: 20,
      },
    };
    const nativeSession = {
      ...legacyRow(
        "native-session",
        "readingSessions",
        "user-a",
        "21-0-device-a",
      ),
      data: { bookId: "book-1", source: "reader-v2" },
    };
    const inferredSession = {
      ...legacyRow(
        "inferred-session",
        "readingSessions",
        "user-a",
        "22-0-device-a",
      ),
      data: { bookId: "book-1", source: "legacy-reading-progress" },
    };

    const migration = migrateLegacySyncRows([
      checkpoint,
      nativeSession,
      inferredSession,
    ]);

    expect(migration.report).toMatchObject({
      sourceRows: 3,
      totalRows: 2,
      excludedRows: 1,
      exclusions: [
        {
          reason: "inferred-legacy-reading-session",
          tableName: "readingSessions",
          totalRows: 1,
        },
      ],
    });
    expect(migration.records.map((record) => record.key)).toEqual([
      encodeSyncKey("readingCheckpoints", "checkpoint-1"),
      encodeSyncKey("readingSessions", "native-session"),
    ]);
  });

  it("reduces the production-shaped source from 45,975 to 786 records", () => {
    const rows: LegacySyncDataRow[] = [];
    appendLegacyRows(rows, 45_017, "progress", "readingProgress");
    appendLegacyRows(rows, 172, "inferred-session", "readingSessions", {
      source: "legacy-reading-progress",
    });
    appendLegacyRows(rows, 209, "native-session", "readingSessions", {
      source: "reader-v2",
    });
    appendLegacyRows(rows, 32, "checkpoint", "readingCheckpoints");
    appendLegacyRows(rows, 27, "book", "books");
    appendLegacyRows(rows, 481, "highlight", "highlights");
    appendLegacyRows(rows, 37, "reading-state", "readingState");

    const migration = migrateLegacySyncRows(rows);

    expect(migration.report).toMatchObject({
      sourceRows: 45_975,
      totalRows: 786,
      excludedRows: 45_189,
      exclusions: [
        {
          reason: "deprecated-reading-progress",
          tableName: "readingProgress",
          totalRows: 45_017,
        },
        {
          reason: "inferred-legacy-reading-session",
          tableName: "readingSessions",
          totalRows: 172,
        },
      ],
    });
    expect(
      Object.fromEntries(
        migration.report.users[0]!.tables.map((table) => [
          table.tableName,
          table.totalRows,
        ]),
      ),
    ).toEqual({
      books: 27,
      highlights: 481,
      readingCheckpoints: 32,
      readingSessions: 209,
      readingState: 37,
    });
  });

  it("produces deterministic output independent of source row order", () => {
    const rows = [
      legacyRow("book-b", "books", "user-b", "20-0-device-b"),
      legacyRow("book-a", "books", "user-a", "10-0-device-a"),
    ];

    const forward = migrateLegacySyncRows(rows);
    const reverse = migrateLegacySyncRows([...rows].reverse());

    expect(reverse.report).toEqual(forward.report);
    expect(createSyncV2SeedSql(reverse.records)).toBe(
      createSyncV2SeedSql(forward.records),
    );
  });

  it("fails before output for malformed or unsupported source rows", () => {
    expect(() =>
      migrateLegacySyncRows([
        legacyRow("bad-hlc", "books", "user-a", "not-an-hlc"),
      ]),
    ).toThrow("Invalid legacy HLC");
    expect(() =>
      migrateLegacySyncRows([
        {
          ...legacyRow("bad-json", "books", "user-a", "10-0-device-a"),
          data: "not-json",
        },
      ]),
    ).toThrow("data is not valid JSON");
    expect(() =>
      migrateLegacySyncRows([
        legacyRow("unknown", "unknownTable", "user-a", "10-0-device-a"),
      ]),
    ).toThrow("unknown table unknownTable");
    expect(() =>
      migrateLegacySyncRows([
        {
          ...legacyRow("bad-device", "books", "user-a", "10-0-device-a"),
          device_id: "invalid device",
        },
      ]),
    ).toThrow("Invalid string");
    expect(() =>
      migrateLegacySyncRows([
        {
          ...legacyRow("too-large", "books", "user-a", "10-0-device-a"),
          data: JSON.stringify({ content: "x".repeat(64 * 1_024) }),
        },
      ]),
    ).toThrow("value must not exceed");
  });

  it("rejects duplicate logical keys", () => {
    const duplicate = legacyRow(
      "duplicate",
      "books",
      "user-a",
      "10-0-device-a",
    );

    expect(() => migrateLegacySyncRows([duplicate, duplicate])).toThrow(
      "duplicate user and logical key",
    );
  });
});

async function insertLegacyRow(row: {
  id: string;
  tableName: string;
  userId: string;
  hlc: string;
  deviceId: string;
  isDeleted: boolean;
  data: Record<string, unknown>;
}): Promise<void> {
  await env.DATABASE.prepare(
    `INSERT INTO sync_data (
       id, table_name, user_id, entity_id, hlc, device_id,
       is_deleted, server_timestamp, data
     ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
  )
    .bind(
      row.id,
      row.tableName,
      row.userId,
      row.hlc,
      row.deviceId,
      row.isDeleted ? 1 : 0,
      Number(row.hlc.split("-", 1)[0]),
      JSON.stringify(row.data),
    )
    .run();
}

async function readLegacyRows(userId: string): Promise<LegacySyncDataRow[]> {
  const result = await env.DATABASE.prepare(
    `SELECT id, table_name, user_id, hlc, device_id, is_deleted, data
     FROM sync_data
     WHERE user_id = ?`,
  )
    .bind(userId)
    .all<LegacySyncDataRow>();
  return result.results;
}

function legacyRow(
  id: string,
  tableName: string,
  userId: string,
  hlc: string,
): LegacySyncDataRow {
  return {
    id,
    table_name: tableName,
    user_id: userId,
    hlc,
    device_id: hlc.split("-").slice(2).join("-"),
    is_deleted: 0,
    data: JSON.stringify({ title: id }),
  };
}

function appendLegacyRows(
  rows: LegacySyncDataRow[],
  count: number,
  idPrefix: string,
  tableName: string,
  data: Record<string, unknown> = {},
): void {
  for (let index = 0; index < count; index += 1) {
    rows.push({
      ...legacyRow(
        `${idPrefix}-${index}`,
        tableName,
        "production-user",
        `${1_000 + index}-0-production-device`,
      ),
      data,
    });
  }
}
