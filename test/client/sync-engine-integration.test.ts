/**
 * Sync Engine Integration Tests with DexieJS
 *
 * Tests the sync engine with the real DexieJS storage adapter,
 * ensuring end-to-end functionality with actual IndexedDB operations.
 *
 * This test suite validates:
 * - Push operations: Local changes are detected and pushed to the mock server
 * - Pull operations: Remote changes are fetched and applied to local storage
 * - Conflict resolution: HLC-based Last-Write-Wins conflict handling
 * - Cursor management: Incremental sync with proper cursor tracking
 * - Entity-scoped operations: Syncing subsets of data (e.g., per-project tasks)
 * - Tombstones: Deletion sync with _isDeleted markers
 * - Bulk operations: Performance with large datasets
 * - Edge cases: Rapid syncs, HLC clock updates
 *
 * Unlike the unit tests in sync-engine.test.ts which use mock adapters,
 * these integration tests use the real DexieJS storage adapter to ensure
 * the sync engine works correctly with actual IndexedDB operations through
 * the Dexie middleware layer.
 */

import {
  createSyncConfig,
  createSyncMiddleware,
  generateDexieStores,
  UNSYNCED_TIMESTAMP,
  type HLCService,
  type SyncMetadata,
} from "@/lib/sync/hlc";
import { createHLCService } from "@/lib/sync";
import type { SyncItem } from "@/lib/sync/storage-adapter";
import { createDexieStorageAdapter } from "@/lib/sync/storage-adapter";
import { createSyncEngine, type SyncEngine } from "@/lib/sync/sync-engine";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createMockRemoteAdapter,
  type MockRemoteAdapter,
} from "./mocks/sync-adapters";
import { resetIndexedDB } from "../setup/indexeddb";

// Test data interfaces
interface Note {
  id: string;
  content: string;
  createdAt: number;
}

interface Task {
  id: string;
  projectId: string;
  title: string;
  completed: boolean;
}

type NoteWithSync = Note & SyncMetadata;
type TaskWithSync = Task & SyncMetadata;

// Test database
class TestDatabase extends Dexie {
  notes!: Dexie.Table<NoteWithSync, string>;
  tasks!: Dexie.Table<TaskWithSync, string>;

  constructor() {
    super("TestSyncDatabase");
  }
}

describe("Sync Engine Integration with DexieJS", () => {
  let db: TestDatabase;
  let hlc: HLCService;
  let remote: MockRemoteAdapter;
  let engine: SyncEngine;
  const deviceId = "test-device-1";

  beforeEach(async () => {
    // Clear state
    resetIndexedDB();
    localStorage.clear();

    // Create HLC service
    hlc = createHLCService(deviceId);

    // Define sync configuration
    const syncConfig = createSyncConfig({
      notes: {
        primaryKey: "id",
        indices: ["createdAt"],
      },
      tasks: {
        primaryKey: "id",
        indices: ["projectId", "completed"],
        compoundIndices: [["projectId", "completed"]],
        entityKey: "projectId",
      },
    });

    // Generate Dexie schemas
    const schemas = generateDexieStores(syncConfig.tables);

    // Create database
    db = new TestDatabase();
    db.version(1).stores(schemas);

    // Apply sync middleware
    db.use(
      createSyncMiddleware({
        hlc,
        syncedTables: new Set(Object.keys(syncConfig.tables)),
        onLocalMutation: () => {}, // Not needed for these tests
      }),
    );

    await db.open();

    // Create storage adapter
    const storage = createDexieStorageAdapter(
      db as unknown as { [key: string]: Dexie.Table },
      {
        notes: {},
        tasks: { entityKey: "projectId" },
      },
    );

    // Create mock remote adapter
    remote = createMockRemoteAdapter();

    // Create sync engine
    engine = createSyncEngine(storage, remote, hlc);
  });

  afterEach(async () => {
    if (db) {
      db.close();
      await db.delete();
    }
  });

  describe("Push with DexieJS", () => {
    it("should push local changes from DexieJS to server", async () => {
      // Create local notes - middleware will add sync metadata
      const note1: Note = {
        id: "note-1",
        content: "First note",
        createdAt: Date.now(),
      };

      const note2: Note = {
        id: "note-2",
        content: "Second note",
        createdAt: Date.now() + 1000,
      };

      await db.notes.add(note1 as NoteWithSync);
      await db.notes.add(note2 as NoteWithSync);

      // Verify notes have sync metadata
      const storedNote1 = await db.notes.get("note-1");
      expect(storedNote1?._serverTimestamp).toBe(UNSYNCED_TIMESTAMP);
      expect(storedNote1?._hlc).toBeDefined();
      expect(storedNote1?._deviceId).toBe(deviceId);

      // Perform sync
      const result = await engine.push("notes");

      expect(result.pushed).toBe(2);
      expect(result.errors).toHaveLength(0);

      // Verify items are on the server
      const serverItems = remote.getServerItems("notes");
      expect(serverItems).toHaveLength(2);
      expect(
        serverItems.every(
          (item) => item._serverTimestamp !== UNSYNCED_TIMESTAMP,
        ),
      ).toBe(true);

      // Verify local items have server timestamps now
      const updatedNote1 = await db.notes.get("note-1");
      expect(updatedNote1?._serverTimestamp).not.toBe(UNSYNCED_TIMESTAMP);
    });

    it("should handle entity-scoped push for tasks", async () => {
      // Create tasks for different projects
      const task1: Task = {
        id: "task-1",
        projectId: "project-a",
        title: "Task A1",
        completed: false,
      };

      const task2: Task = {
        id: "task-2",
        projectId: "project-b",
        title: "Task B1",
        completed: false,
      };

      await db.tasks.add(task1 as TaskWithSync);
      await db.tasks.add(task2 as TaskWithSync);

      // Note: entityId in push options doesn't filter, it just logs
      // Both tasks will be pushed
      const result = await engine.push("tasks");

      expect(result.pushed).toBe(2);

      // Verify both tasks are on server
      const serverItems = remote.getServerItems("tasks");
      expect(serverItems).toHaveLength(2);
    });

    it("should handle bulk operations efficiently", async () => {
      const count = 100;
      const notes: Note[] = [];

      for (let i = 0; i < count; i++) {
        notes.push({
          id: `note-${i}`,
          content: `Note ${i}`,
          createdAt: Date.now() + i,
        });
      }

      // Bulk add to DexieJS
      await db.notes.bulkAdd(notes as NoteWithSync[]);

      // Push all notes
      const startTime = Date.now();
      const result = await engine.push("notes");
      const duration = Date.now() - startTime;

      expect(result.pushed).toBe(count);
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds

      // Verify all have server timestamps
      const allNotes = await db.notes.toArray();
      expect(
        allNotes.every((n) => n._serverTimestamp !== UNSYNCED_TIMESTAMP),
      ).toBe(true);
    });
  });

  describe("Pull with DexieJS", () => {
    it("should pull remote changes and save to DexieJS", async () => {
      const serverTime = Date.now();
      remote.setServerTime(serverTime);

      // Setup remote data
      const remoteNote: SyncItem = {
        id: "note-remote",
        entityId: undefined,
        _hlc: hlc.next(),
        _deviceId: "other-device",
        _isDeleted: false,
        _serverTimestamp: serverTime,
        data: {
          content: "Remote note",
          createdAt: serverTime,
        },
      };

      remote.setServerItems("notes", [remoteNote]);

      // Perform pull
      const result = await engine.pull("notes");

      expect(result.pulled).toBe(1);
      expect(result.hasMore).toBe(false);

      // Verify note is in DexieJS
      const localNote = await db.notes.get("note-remote");
      expect(localNote).toBeDefined();
      expect(localNote?.content).toBe("Remote note");
      expect(localNote?._deviceId).toBe("other-device");
      expect(localNote?._serverTimestamp).toBe(serverTime);
    });

    it("should handle conflict resolution with DexieJS storage", async () => {
      const serverTime = Date.now();
      remote.setServerTime(serverTime);

      // Create local note
      const localNote: Note = {
        id: "note-conflict",
        content: "Local version",
        createdAt: serverTime - 5000,
      };

      await db.notes.add(localNote as NoteWithSync);

      // Get the local item to check its HLC
      const localItem = await db.notes.get("note-conflict");
      const localHlc = localItem?._hlc || "";

      // Create remote note with newer HLC (manually construct a later one)
      const parts = localHlc.split("-");
      const timestamp = parseInt(parts[0], 10);
      const futureHlc = `${timestamp + 10000}-0-other-device`;

      const remoteNote: SyncItem = {
        id: "note-conflict",
        entityId: undefined,
        _hlc: futureHlc,
        _deviceId: "other-device",
        _isDeleted: false,
        _serverTimestamp: serverTime,
        data: {
          content: "Remote version (newer)",
          createdAt: serverTime,
        },
      };

      remote.setServerItems("notes", [remoteNote]);

      // Pull - remote should win due to newer HLC
      const result = await engine.pull("notes");

      expect(result.pulled).toBe(1);
      // Conflict was resolved - remote version won

      // Verify remote version won (newer HLC)
      const resolvedNote = await db.notes.get("note-conflict");
      expect(resolvedNote?.content).toBe("Remote version (newer)");
      expect(resolvedNote?._hlc).toBe(futureHlc);
      expect(resolvedNote?._deviceId).toBe("other-device");
    });

    it("should handle deleted items (tombstones)", async () => {
      const serverTime = Date.now();
      remote.setServerTime(serverTime);

      // Create local note
      const localNote: Note = {
        id: "note-delete",
        content: "To be deleted",
        createdAt: serverTime - 1000,
      };

      await db.notes.add(localNote as NoteWithSync);

      // Verify note exists
      let note = await db.notes.get("note-delete");
      expect(note).toBeDefined();

      // Remote has tombstone with newer HLC
      const localItem = await db.notes.get("note-delete");
      const localHlc = localItem?._hlc || "";
      const parts = localHlc.split("-");
      const timestamp = parseInt(parts[0], 10);
      const futureHlc = `${timestamp + 10000}-0-other-device`;

      const tombstone: SyncItem = {
        id: "note-delete",
        entityId: undefined,
        _hlc: futureHlc,
        _deviceId: "other-device",
        _isDeleted: true,
        _serverTimestamp: serverTime,
        data: {
          content: "To be deleted",
          createdAt: serverTime - 1000,
        },
      };

      remote.setServerItems("notes", [tombstone]);

      // Pull tombstone
      await engine.pull("notes");

      // Verify note is marked as deleted but still in DB
      note = await db.notes.get("note-delete");
      expect(note).toBeDefined();
      expect(note?._isDeleted).toBe(1); // Stored as 1 (number) not true
    });
  });

  describe("Full Sync with DexieJS", () => {
    it("should perform complete push and pull cycle", async () => {
      const serverTime = Date.now();
      remote.setServerTime(serverTime);

      // Create local note
      const localNote: Note = {
        id: "note-local",
        content: "Local note",
        createdAt: serverTime,
      };

      await db.notes.add(localNote as NoteWithSync);

      // Create remote note
      const remoteNote: SyncItem = {
        id: "note-remote",
        entityId: undefined,
        _hlc: hlc.next(),
        _deviceId: "other-device",
        _isDeleted: false,
        _serverTimestamp: serverTime,
        data: {
          content: "Remote note",
          createdAt: serverTime,
        },
      };

      remote.setServerItems("notes", [remoteNote]);

      // Perform full sync
      const result = await engine.sync("notes");

      expect(result.pushed).toBe(1);
      expect(result.pulled).toBe(1);

      // Verify both notes are in local storage
      const allNotes = await db.notes.toArray();
      expect(allNotes).toHaveLength(2);

      const noteIds = allNotes.map((n) => n.id).sort();
      expect(noteIds).toEqual(["note-local", "note-remote"]);

      // Verify local note has server timestamp
      const local = await db.notes.get("note-local");
      expect(local?._serverTimestamp).not.toBe(UNSYNCED_TIMESTAMP);
    });
  });

  describe("Cursor management with DexieJS", () => {
    it("should persist cursor and only pull new data", async () => {
      const serverTime = Date.now();
      remote.setServerTime(serverTime);

      // Create and pull first remote note
      const remoteNote1: SyncItem = {
        id: "note-1",
        entityId: undefined,
        _hlc: hlc.next(),
        _deviceId: "other-device",
        _isDeleted: false,
        _serverTimestamp: serverTime,
        data: {
          content: "First note",
          createdAt: serverTime,
        },
      };

      remote.setServerItems("notes", [remoteNote1]);
      await engine.pull("notes");

      // Verify first note is in DB
      let allNotes = await db.notes.toArray();
      expect(allNotes).toHaveLength(1);

      // Advance server time and add new note
      remote.advanceServerTime(5000);
      const newServerTime = serverTime + 5000;

      const remoteNote2: SyncItem = {
        id: "note-2",
        entityId: undefined,
        _hlc: hlc.next(),
        _deviceId: "other-device",
        _isDeleted: false,
        _serverTimestamp: newServerTime,
        data: {
          content: "Second note",
          createdAt: newServerTime,
        },
      };

      remote.setServerItems("notes", [remoteNote1, remoteNote2]);

      // Pull again - should only get the new note
      const result = await engine.pull("notes");

      expect(result.pulled).toBe(1);

      allNotes = await db.notes.toArray();
      expect(allNotes).toHaveLength(2);

      // Verify we got the second note
      const note2 = await db.notes.get("note-2");
      expect(note2).toBeDefined();
      expect(note2?.content).toBe("Second note");
    });

    it("should handle entity-scoped sync for tasks table", async () => {
      const serverTime = Date.now();
      remote.setServerTime(serverTime);

      // Create local tasks for multiple projects
      await db.tasks.add({
        id: "task-a1",
        projectId: "project-a",
        title: "Task A1",
        completed: false,
      } as TaskWithSync);

      await db.tasks.add({
        id: "task-b1",
        projectId: "project-b",
        title: "Task B1",
        completed: false,
      } as TaskWithSync);

      // Create remote task for project-a
      const remoteTask: SyncItem = {
        id: "task-a2",
        entityId: "project-a",
        _hlc: hlc.next(),
        _deviceId: "other-device",
        _isDeleted: false,
        _serverTimestamp: serverTime,
        data: {
          projectId: "project-a",
          title: "Task A2 from remote",
          completed: true,
        },
      };

      remote.setServerItems("tasks", [remoteTask]);

      // Sync only project-a
      const result = await engine.sync("tasks", { entityId: "project-a" });

      expect(result.pushed).toBe(2); // Both tasks pushed (entityId doesn't filter push)
      expect(result.pulled).toBe(1); // Only project-a task pulled

      // Verify project-a tasks
      const projectATasks = await db.tasks
        .where("projectId")
        .equals("project-a")
        .toArray();

      expect(projectATasks).toHaveLength(2);
      expect(projectATasks.some((t) => t.id === "task-a2")).toBe(true);
    });
  });

  describe("Local modifications of synced records", () => {
    it("should detect local modifications of previously synced records", async () => {
      const serverTime = Date.now();

      // Step 1: Pull a remote note (simulating initial sync)
      const remoteNote: SyncItem = {
        id: "note-from-server",
        entityId: undefined,
        _hlc: hlc.next(),
        _deviceId: "other-device",
        _isDeleted: false,
        _serverTimestamp: serverTime,
        data: {
          content: "Original content from server",
          createdAt: serverTime,
        },
      };

      remote.setServerItems("notes", [remoteNote]);
      const pullResult = await engine.pull("notes");
      expect(pullResult.pulled).toBe(1);

      // Verify the note was saved with server timestamp
      let localNote = await db.notes.get("note-from-server");
      expect(localNote).toBeDefined();
      expect(localNote!.content).toBe("Original content from server");
      expect(localNote!._serverTimestamp).toBe(serverTime);

      // Step 2: Modify the note locally (read-modify-write pattern)
      localNote!.content = "Modified locally";
      await db.notes.put(localNote!);

      // Step 3: Check that the modification is detected as pending
      // This is where the bug occurs - the middleware sees _serverTimestamp
      // and thinks it's a remote write, so it doesn't update sync metadata
      const updatedNote = await db.notes.get("note-from-server");
      expect(updatedNote).toBeDefined();
      expect(updatedNote!.content).toBe("Modified locally");

      // BUG: This should be UNSYNCED_TIMESTAMP but it's still serverTime
      // because middleware didn't detect this as a local write
      expect(updatedNote!._serverTimestamp).toBe(UNSYNCED_TIMESTAMP);

      // The HLC should also be updated to a new local timestamp
      expect(updatedNote!._hlc).not.toBe(remoteNote._hlc);
      expect(updatedNote!._deviceId).toBe(deviceId);

      // Step 4: Verify it appears in pending changes
      const pushResult = await engine.push("notes");
      expect(pushResult.pushed).toBe(1);

      const serverItems = remote.getServerItems("notes");
      const pushedNote = serverItems.find(
        (item) => item.id === "note-from-server",
      );
      expect(pushedNote).toBeDefined();
      expect(pushedNote!.data.content).toBe("Modified locally");
    });

    it("should handle creating tombstone for synced record", async () => {
      const serverTime = Date.now();

      // Step 1: Pull a remote note
      const remoteNote: SyncItem = {
        id: "note-to-delete",
        entityId: undefined,
        _hlc: hlc.next(),
        _deviceId: "other-device",
        _isDeleted: false,
        _serverTimestamp: serverTime,
        data: {
          content: "Will be deleted",
          createdAt: serverTime,
        },
      };

      remote.setServerItems("notes", [remoteNote]);
      await engine.pull("notes");

      // Step 2: Delete it locally (read and mark as deleted)
      const localNote = await db.notes.get("note-to-delete");
      expect(localNote).toBeDefined();

      const tombstone = { ...localNote!, _isDeleted: 1 };
      await db.notes.put(tombstone);

      // Step 3: Verify deletion is tracked for sync
      const deletedNote = await db.notes.get("note-to-delete");
      expect(deletedNote).toBeDefined();
      expect(deletedNote!._isDeleted).toBe(1);
      expect(deletedNote!._serverTimestamp).toBe(UNSYNCED_TIMESTAMP);

      // Step 4: Verify it's pushed to server
      const pushResult = await engine.push("notes");
      expect(pushResult.pushed).toBe(1);

      const serverItems = remote.getServerItems("notes");
      const deletedOnServer = serverItems.find(
        (item) => item.id === "note-to-delete",
      );
      expect(deletedOnServer).toBeDefined();
      expect(deletedOnServer!._isDeleted).toBe(true);
    });
  });

  describe("Edge cases", () => {
    it("should handle rapid successive syncs", async () => {
      const serverTime = Date.now();
      remote.setServerTime(serverTime);

      // Create local note
      await db.notes.add({
        id: "note-1",
        content: "Test note",
        createdAt: serverTime,
      } as NoteWithSync);

      // Perform three syncs in rapid succession
      const result1 = engine.push("notes");
      const result2 = engine.push("notes");
      const result3 = engine.push("notes");

      await Promise.all([result1, result2, result3]);

      // Verify note is on server exactly once
      const serverItems = remote.getServerItems("notes");
      expect(serverItems).toHaveLength(1);
      expect(serverItems[0]._serverTimestamp).not.toBe(UNSYNCED_TIMESTAMP);
    });

    it("should update HLC clock when receiving remote timestamps", async () => {
      const serverTime = Date.now();
      remote.setServerTime(serverTime);

      // Get current HLC state
      const initialState = hlc.getState();

      // Create remote note with future HLC
      const futureHlc = `${Date.now() + 100000}-0-other-device`;

      const remoteNote: SyncItem = {
        id: "note-1",
        entityId: undefined,
        _hlc: futureHlc,
        _deviceId: "other-device",
        _isDeleted: false,
        _serverTimestamp: serverTime,
        data: {
          content: "Future note",
          createdAt: serverTime,
        },
      };

      remote.setServerItems("notes", [remoteNote]);

      // Pull remote note
      await engine.pull("notes");

      // HLC should have been updated
      const updatedState = hlc.getState();
      expect(updatedState.timestamp).toBeGreaterThanOrEqual(
        initialState.timestamp,
      );
    });
  });
});

/**
 * Separate test suite for books table with unique fileHash constraint
 *
 * Tests that the sync engine correctly handles deduplication of books
 * based on fileHash to prevent unique constraint violations.
 */
interface Book {
  id: string;
  fileHash: string;
  title: string;
  author: string;
}

type BookWithSync = Book & SyncMetadata;

class BooksTestDatabase extends Dexie {
  books!: Dexie.Table<BookWithSync, string>;

  constructor() {
    super("BooksTestDatabase");
  }
}

describe("Sync Engine - Books fileHash deduplication", () => {
  let db: BooksTestDatabase;
  let hlc: HLCService;
  let remote: MockRemoteAdapter;
  let engine: SyncEngine;
  const deviceId = "test-device-1";

  beforeEach(async () => {
    resetIndexedDB();
    localStorage.clear();

    hlc = createHLCService(deviceId);

    // Define sync configuration with unique fileHash index
    const syncConfig = createSyncConfig({
      books: {
        primaryKey: "id",
        indices: [],
        uniqueIndices: ["fileHash"],
      },
    });

    const schemas = generateDexieStores(syncConfig.tables);

    db = new BooksTestDatabase();
    db.version(1).stores(schemas);

    db.use(
      createSyncMiddleware({
        hlc,
        syncedTables: new Set(["books"]),
        onLocalMutation: () => {},
      }),
    );

    await db.open();

    const storage = createDexieStorageAdapter(
      db as unknown as { [key: string]: Dexie.Table },
      { books: {} },
    );

    remote = createMockRemoteAdapter();
    engine = createSyncEngine(storage, remote, hlc);
  });

  afterEach(async () => {
    if (db) {
      db.close();
      await db.delete();
    }
  });

  it("should skip remote books with duplicate fileHash", async () => {
    const serverTime = Date.now();
    remote.setServerTime(serverTime);

    // Create a local book
    const localBook: Book = {
      id: "book-local",
      fileHash: "hash-123",
      title: "Local Book",
      author: "Local Author",
    };
    await db.books.add(localBook as BookWithSync);

    // Create remote books - one has the same fileHash as local
    const remoteBooks: SyncItem[] = [
      {
        id: "book-remote-1",
        entityId: undefined,
        _hlc: hlc.next(),
        _deviceId: "other-device",
        _isDeleted: false,
        _serverTimestamp: serverTime,
        data: {
          fileHash: "hash-123", // Same as local book - should be skipped
          title: "Remote Book 1 (duplicate hash)",
          author: "Remote Author 1",
        },
      },
      {
        id: "book-remote-2",
        entityId: undefined,
        _hlc: hlc.next(),
        _deviceId: "other-device",
        _isDeleted: false,
        _serverTimestamp: serverTime + 1,
        data: {
          fileHash: "hash-456", // Different hash - should be applied
          title: "Remote Book 2",
          author: "Remote Author 2",
        },
      },
    ];

    remote.setServerItems("books", remoteBooks);

    // Pull should not throw and should skip the duplicate
    const result = await engine.pull("books");

    // Only 1 book should be applied (the one with unique fileHash)
    // result.pulled counts applied items, not processed items
    expect(result.pulled).toBe(1); // Only book-remote-2 was applied

    const allBooks = await db.books.toArray();
    expect(allBooks).toHaveLength(2); // local + one remote

    // Verify local book is still there
    const localResult = await db.books.get("book-local");
    expect(localResult).toBeDefined();
    expect(localResult?.title).toBe("Local Book");

    // Verify the unique remote book was added
    const remote2 = await db.books.get("book-remote-2");
    expect(remote2).toBeDefined();
    expect(remote2?.fileHash).toBe("hash-456");

    // Verify the duplicate was NOT added
    const remote1 = await db.books.get("book-remote-1");
    expect(remote1).toBeUndefined();
  });

  it("should skip multiple remote books with same fileHash among themselves", async () => {
    const serverTime = Date.now();
    remote.setServerTime(serverTime);

    // Create remote books where multiple have the same fileHash
    const remoteBooks: SyncItem[] = [
      {
        id: "book-1",
        entityId: undefined,
        _hlc: hlc.next(),
        _deviceId: "device-a",
        _isDeleted: false,
        _serverTimestamp: serverTime,
        data: {
          fileHash: "same-hash",
          title: "Book from Device A",
          author: "Author A",
        },
      },
      {
        id: "book-2",
        entityId: undefined,
        _hlc: hlc.next(),
        _deviceId: "device-b",
        _isDeleted: false,
        _serverTimestamp: serverTime + 1,
        data: {
          fileHash: "same-hash", // Same hash - should be skipped
          title: "Book from Device B",
          author: "Author B",
        },
      },
      {
        id: "book-3",
        entityId: undefined,
        _hlc: hlc.next(),
        _deviceId: "device-c",
        _isDeleted: false,
        _serverTimestamp: serverTime + 2,
        data: {
          fileHash: "same-hash", // Same hash - should be skipped
          title: "Book from Device C",
          author: "Author C",
        },
      },
      {
        id: "book-4",
        entityId: undefined,
        _hlc: hlc.next(),
        _deviceId: "device-d",
        _isDeleted: false,
        _serverTimestamp: serverTime + 3,
        data: {
          fileHash: "different-hash",
          title: "Book from Device D",
          author: "Author D",
        },
      },
    ];

    remote.setServerItems("books", remoteBooks);

    // Pull should not throw
    const result = await engine.pull("books");
    // result.pulled counts applied items: book-1 (first with "same-hash") + book-4 (unique "different-hash")
    expect(result.pulled).toBe(2);

    // Only 2 books should be in the database (first of each unique fileHash)
    const allBooks = await db.books.toArray();
    expect(allBooks).toHaveLength(2);

    // Verify the first book with "same-hash" was added
    const book1 = await db.books.get("book-1");
    expect(book1).toBeDefined();
    expect(book1?.fileHash).toBe("same-hash");

    // Verify duplicates were NOT added
    const book2 = await db.books.get("book-2");
    expect(book2).toBeUndefined();
    const book3 = await db.books.get("book-3");
    expect(book3).toBeUndefined();

    // Verify the unique hash book was added
    const book4 = await db.books.get("book-4");
    expect(book4).toBeDefined();
    expect(book4?.fileHash).toBe("different-hash");
  });
});
