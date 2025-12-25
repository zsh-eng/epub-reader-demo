/**
 * Reading State Tests
 *
 * Tests for the reading state database operations.
 */

import {
  getAllReadingStatuses,
  getReadingHistory,
  getReadingStatus,
  setReadingStatus,
} from "@/lib/db";
import Dexie from "dexie";
import { describe, expect, it, beforeEach } from "vitest";

// Use fake IndexedDB for tests
import "fake-indexeddb/auto";

describe("Reading State", () => {
  beforeEach(async () => {
    // Clear the database before each test
    await Dexie.delete("epub-reader-db");
  });

  describe("setReadingStatus()", () => {
    it("should create a new log entry when setting status", async () => {
      const bookId = "test-book-123";
      const id = await setReadingStatus(bookId, "reading");

      expect(id).toBeDefined();
      expect(typeof id).toBe("string");
    });

    it("should allow setting different statuses for the same book", async () => {
      const bookId = "test-book-123";

      await setReadingStatus(bookId, "reading");
      await setReadingStatus(bookId, "finished");

      const history = await getReadingHistory(bookId);
      expect(history.length).toBe(2);
      expect(history[0].status).toBe("reading");
      expect(history[1].status).toBe("finished");
    });
  });

  describe("getReadingStatus()", () => {
    it("should return null for a book with no status entries", async () => {
      const status = await getReadingStatus("nonexistent-book");
      expect(status).toBeNull();
    });

    it("should return the latest status for a book", async () => {
      const bookId = "test-book-123";

      await setReadingStatus(bookId, "reading");
      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 10));
      await setReadingStatus(bookId, "finished");

      const status = await getReadingStatus(bookId);
      expect(status).toBe("finished");
    });
  });

  describe("getAllReadingStatuses()", () => {
    it("should return empty map when no statuses exist", async () => {
      const statuses = await getAllReadingStatuses();
      expect(statuses.size).toBe(0);
    });

    it("should return latest status for each book", async () => {
      await setReadingStatus("book-1", "reading");
      await setReadingStatus("book-2", "finished");
      await setReadingStatus("book-1", "finished");

      const statuses = await getAllReadingStatuses();

      expect(statuses.size).toBe(2);
      expect(statuses.get("book-1")).toBe("finished");
      expect(statuses.get("book-2")).toBe("finished");
    });
  });

  describe("getReadingHistory()", () => {
    it("should return empty array for a book with no history", async () => {
      const history = await getReadingHistory("nonexistent-book");
      expect(history).toEqual([]);
    });

    it("should return all status entries in chronological order", async () => {
      const bookId = "test-book-123";

      await setReadingStatus(bookId, "want-to-read");
      await new Promise((r) => setTimeout(r, 10));
      await setReadingStatus(bookId, "reading");
      await new Promise((r) => setTimeout(r, 10));
      await setReadingStatus(bookId, "finished");

      const history = await getReadingHistory(bookId);

      expect(history.length).toBe(3);
      expect(history[0].status).toBe("want-to-read");
      expect(history[1].status).toBe("reading");
      expect(history[2].status).toBe("finished");

      // Verify timestamps are in ascending order
      expect(history[0].timestamp).toBeLessThan(history[1].timestamp);
      expect(history[1].timestamp).toBeLessThan(history[2].timestamp);
    });
  });
});
