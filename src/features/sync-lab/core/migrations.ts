import {
  EPUBReaderSyncV2DB,
  SYNC_V2_VERSION_3_STORES,
  SYNC_V2_VERSION_4_STORES,
} from "@/lib/sync-v2/db";
import { computeFileId } from "@/lib/files/file-id";
import Dexie from "dexie";

export interface MigrationDatabaseSummary {
  version: number;
  counts: Record<string, number>;
  book: Record<string, unknown>;
  note: Record<string, unknown>;
}
export interface MigrationCheck {
  label: string;
  passed: boolean;
}
export interface MigrationReport {
  databaseName: string;
  fromVersion: 3 | 5;
  toVersion: number;
  before: MigrationDatabaseSummary;
  after: MigrationDatabaseSummary;
  checks: MigrationCheck[];
  passed: boolean;
}

async function summarize(database: Dexie): Promise<MigrationDatabaseSummary> {
  const counts = Object.fromEntries(
    await Promise.all(
      database.tables.map(async (table) => [table.name, await table.count()]),
    ),
  );
  return {
    version: database.verno,
    counts,
    book: await database.table("books").get("migration-book"),
    note: await database.table("notes").get("migration-note"),
  };
}

/**
 * Opens a real historical IndexedDB fixture with the current schema. All data is
 * synthetic and the temporary database is deleted, including on upgrade failure.
 * This checks storage upgrades, not app-version or wire-format compatibility.
 */
export async function runMigrationScenario(
  version: 3 | 5,
): Promise<MigrationReport> {
  const databaseName = `sync-lab-migration-${crypto.randomUUID()}`;
  const legacy = new Dexie(databaseName);
  const current = new EPUBReaderSyncV2DB(databaseName);
  try {
    legacy.version(version).stores(
      version === 3
        ? SYNC_V2_VERSION_3_STORES
        : {
            ...SYNC_V2_VERSION_4_STORES,
            bookMaterializations: "bookId, sourceFileId, recipeVersion",
          },
    );
    await legacy.open();
    const content = "Sync Lab migration fixture: preserved binary bytes.";
    const blob = new Blob([content], { type: "application/epub+zip" });
    const sourceFileId = await computeFileId(blob);
    const book = {
      id: "migration-book",
      title: "Migration specimen",
      author: "Sync Lab",
      fileSize: blob.size,
      dateAdded: 100,
      metadata: {},
      manifest: [],
      spine: [],
      toc: [],
      isDeleted: false,
      ...(version === 3
        ? { fileHash: sourceFileId.slice(6), isDownloaded: 1 }
        : { sourceFileId, cover: null }),
    };
    const note = {
      id: "migration-note",
      annotationId: "annotation-1",
      bookId: book.id,
      spineItemId: "chapter-1",
      content: "Keep this note through the upgrade",
      createdAt: 100,
      isDeleted: false,
    };
    await legacy.table("books").put(book);
    await legacy.table("notes").put(note);
    await legacy.table("files").put({
      id: sourceFileId,
      blob,
      mediaType: blob.type,
      size: blob.size,
      storedAt: 100,
      remotePresent: true,
    });
    await legacy.table("bookChapterSourceCache").put({
      bookId: book.id,
      fileHash: sourceFileId.slice(6),
      cacheVersion: 1,
      chaptersByPath: {},
      updatedAt: 100,
    });
    const before = await summarize(legacy);
    legacy.close();
    await current.open();
    const after = await summarize(current);
    const migratedFile = await current.files.get(sourceFileId);
    const checks = [
      {
        label: "Book file reference uses the opaque file ID",
        passed:
          after.book.sourceFileId === sourceFileId &&
          !("fileHash" in after.book),
      },
      {
        label: "Stored file bytes are unchanged",
        passed:
          migratedFile !== undefined &&
          new TextDecoder().decode(await migratedFile.blob.arrayBuffer()) ===
            content,
      },
      {
        label: "Existing note fields are preserved",
        passed: JSON.stringify(after.note) === JSON.stringify(before.note),
      },
      {
        label: "Local note drafts table is added empty",
        passed:
          !("noteDrafts" in before.counts) && after.counts.noteDrafts === 0,
      },
      {
        label: "Materialization table is available",
        passed: after.counts.bookMaterializations === 0,
      },
      {
        label:
          version === 3
            ? "Old derived chapter cache is discarded"
            : "Existing chapter cache is preserved",
        passed: after.counts.bookChapterSourceCache === (version === 3 ? 0 : 1),
      },
      {
        label: "Raw schema upgrade does not create sync changes",
        passed: after.counts._sync_outbox === 0,
      },
    ];
    return {
      databaseName,
      fromVersion: version,
      toVersion: current.verno,
      before,
      after,
      checks,
      passed: checks.every((check) => check.passed),
    };
  } finally {
    legacy.close();
    current.close();
    await Dexie.delete(databaseName);
  }
}
