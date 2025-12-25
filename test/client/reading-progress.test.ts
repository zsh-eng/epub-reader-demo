/**
 * Tests for Reading Progress Historical Tracking
 *
 * Verifies that:
 * - Reading progress is stored with unique IDs
 * - Multiple progress records can exist per book
 * - Progress records have proper structure (id, bookId, createdAt)
 * - Helper functions work correctly
 */

import {
  db,
  getReadingProgress,
  getReadingProgressHistory,
  saveReadingProgress,
} from "@/lib/db";
import { beforeEach, describe, expect, it } from "vitest";

describe("Reading Progress Historical Tracking", () => {
  const testBookId = "test-book-123";

  beforeEach(async () => {
    db.readingProgress.clear();
    localStorage.clear();
  });

  describe("Schema and Storage", () => {
    it("should generate unique IDs for each progress record", async () => {
      const id1 = await saveReadingProgress({
        bookId: testBookId,
        currentSpineIndex: 0,
        scrollProgress: 0.25,
        lastRead: Date.now(),
      });

      const id2 = await saveReadingProgress({
        bookId: testBookId,
        currentSpineIndex: 1,
        scrollProgress: 0.5,
        lastRead: Date.now(),
      });

      expect(id1).toBeTruthy();
      expect(id2).toBeTruthy();
      expect(id1).not.toBe(id2);
    });

    it("should store multiple progress records for the same book", async () => {
      const now = Date.now();

      // Add three progress records
      await saveReadingProgress({
        bookId: testBookId,
        currentSpineIndex: 0,
        scrollProgress: 0.25,
        lastRead: now - 2000,
      });

      await saveReadingProgress({
        bookId: testBookId,
        currentSpineIndex: 1,
        scrollProgress: 0.5,
        lastRead: now - 1000,
      });

      await saveReadingProgress({
        bookId: testBookId,
        currentSpineIndex: 2,
        scrollProgress: 0.75,
        lastRead: now,
      });

      const allProgress = await db.readingProgress
        .where("bookId")
        .equals(testBookId)
        .toArray();

      expect(allProgress.length).toBeGreaterThanOrEqual(3);
    });

    it("should include createdAt timestamp for each record", async () => {
      const beforeCreation = Date.now();

      await saveReadingProgress({
        bookId: testBookId,
        currentSpineIndex: 0,
        scrollProgress: 0.25,
        lastRead: Date.now(),
      });

      const afterCreation = Date.now();

      const progress = await db.readingProgress
        .where("bookId")
        .equals(testBookId)
        .first();

      expect(progress).toBeTruthy();
      expect(progress!.createdAt).toBeGreaterThanOrEqual(beforeCreation);
      expect(progress!.createdAt).toBeLessThanOrEqual(afterCreation);
    });

    it("should have id different from bookId", async () => {
      await saveReadingProgress({
        bookId: testBookId,
        currentSpineIndex: 0,
        scrollProgress: 0.25,
        lastRead: Date.now(),
      });

      const progress = await db.readingProgress
        .where("bookId")
        .equals(testBookId)
        .first();

      expect(progress).toBeTruthy();
      expect(progress!.id).not.toBe(testBookId);
      expect(progress!.bookId).toBe(testBookId);
    });

    it("should auto-generate UUID for id field", async () => {
      await saveReadingProgress({
        bookId: testBookId,
        currentSpineIndex: 0,
        scrollProgress: 0.25,
        lastRead: Date.now(),
      });

      const progress = await db.readingProgress
        .where("bookId")
        .equals(testBookId)
        .first();

      expect(progress).toBeTruthy();
      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      expect(progress!.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });
  });

  describe("Query Functions", () => {
    it("should retrieve progress for a book using getReadingProgress", async () => {
      const now = Date.now();

      await saveReadingProgress({
        bookId: testBookId,
        currentSpineIndex: 2,
        scrollProgress: 0.75,
        lastRead: now,
      });

      const latestProgress = await getReadingProgress(testBookId);

      expect(latestProgress).toBeTruthy();
      expect(latestProgress!.bookId).toBe(testBookId);
      expect(latestProgress!.currentSpineIndex).toBe(2);
      expect(latestProgress!.scrollProgress).toBe(0.75);
    });

    it("should return undefined for non-existent book", async () => {
      const progress = await getReadingProgress("non-existent-book");
      expect(progress).toBeUndefined();
    });

    it("should handle multiple saves and return a progress record", async () => {
      const now = Date.now();

      // Add multiple progress records
      await saveReadingProgress({
        bookId: testBookId,
        currentSpineIndex: 0,
        scrollProgress: 0.25,
        lastRead: now - 2000,
      });

      await saveReadingProgress({
        bookId: testBookId,
        currentSpineIndex: 1,
        scrollProgress: 0.5,
        lastRead: now - 1000,
      });

      await saveReadingProgress({
        bookId: testBookId,
        currentSpineIndex: 2,
        scrollProgress: 0.75,
        lastRead: now,
      });

      const latestProgress = await getReadingProgress(testBookId);

      expect(latestProgress).toBeTruthy();
      expect(latestProgress!.bookId).toBe(testBookId);
      // Should return one of the progress records
      expect(latestProgress!.currentSpineIndex).toBeGreaterThanOrEqual(0);
      expect(latestProgress!.currentSpineIndex).toBeLessThanOrEqual(2);
    });
  });

  describe("History Query", () => {
    it("should retrieve all history for a book", async () => {
      const now = Date.now();

      // Add 5 progress records
      for (let i = 0; i < 5; i++) {
        await saveReadingProgress({
          bookId: testBookId,
          currentSpineIndex: i,
          scrollProgress: i * 0.2,
          lastRead: now + i * 1000,
        });
      }

      const history = await getReadingProgressHistory(testBookId);

      expect(history.length).toBeGreaterThanOrEqual(5);

      // Check that all records are for the correct book
      for (const record of history) {
        expect(record.bookId).toBe(testBookId);
      }
    });

    it("should limit history when limit parameter is provided", async () => {
      const now = Date.now();

      // Add 5 progress records
      for (let i = 0; i < 5; i++) {
        await saveReadingProgress({
          bookId: testBookId,
          currentSpineIndex: i,
          scrollProgress: i * 0.2,
          lastRead: now + i * 1000,
        });
      }

      const history = await getReadingProgressHistory(testBookId, 3);

      expect(history).toHaveLength(3);
    });

    it("should return empty array for non-existent book", async () => {
      const history = await getReadingProgressHistory("non-existent-book");
      expect(history).toEqual([]);
    });
  });

  describe("Multiple Books", () => {
    it("should keep progress separate per book", async () => {
      const now = Date.now();
      const book1Id = "book-1";
      const book2Id = "book-2";

      // Add progress for book 1
      await saveReadingProgress({
        bookId: book1Id,
        currentSpineIndex: 5,
        scrollProgress: 0.5,
        lastRead: now,
      });

      // Add progress for book 2
      await saveReadingProgress({
        bookId: book2Id,
        currentSpineIndex: 10,
        scrollProgress: 0.8,
        lastRead: now,
      });

      const progress1 = await getReadingProgress(book1Id);
      const progress2 = await getReadingProgress(book2Id);

      expect(progress1).toBeTruthy();
      expect(progress2).toBeTruthy();
      expect(progress1!.currentSpineIndex).toBe(5);
      expect(progress2!.currentSpineIndex).toBe(10);
    });
  });

  describe("Progress Updates", () => {
    it("should create new records instead of updating existing ones", async () => {
      const now = Date.now();

      // First progress save
      await saveReadingProgress({
        bookId: testBookId,
        currentSpineIndex: 0,
        scrollProgress: 0.25,
        lastRead: now,
      });

      // Second progress save (should create new record, not update)
      await saveReadingProgress({
        bookId: testBookId,
        currentSpineIndex: 1,
        scrollProgress: 0.5,
        lastRead: now + 1000,
      });

      const allProgress = await db.readingProgress
        .where("bookId")
        .equals(testBookId)
        .toArray();

      // Should have 2 separate records
      expect(allProgress.length).toBeGreaterThanOrEqual(2);
    });

    it("should preserve all fields when saving progress", async () => {
      const now = Date.now();
      const progressData = {
        bookId: testBookId,
        currentSpineIndex: 3,
        scrollProgress: 0.45,
        pageNumber: 42,
        lastRead: now,
      };

      await saveReadingProgress(progressData);
      const saved = await getReadingProgress(testBookId);

      expect(saved).toBeTruthy();
      expect(saved!.bookId).toBe(progressData.bookId);
      expect(saved!.currentSpineIndex).toBe(progressData.currentSpineIndex);
      expect(saved!.scrollProgress).toBe(progressData.scrollProgress);
      expect(saved!.pageNumber).toBe(progressData.pageNumber);
      expect(saved!.lastRead).toBe(progressData.lastRead);
      expect(saved!.createdAt).toBeDefined();
      expect(saved!.id).toBeDefined();
    });
  });

  describe("Data Integrity", () => {
    it("should not overwrite existing records when saving new progress", async () => {
      const now = Date.now();

      const id1 = await saveReadingProgress({
        bookId: testBookId,
        currentSpineIndex: 0,
        scrollProgress: 0.25,
        lastRead: now - 1000,
      });

      const id2 = await saveReadingProgress({
        bookId: testBookId,
        currentSpineIndex: 1,
        scrollProgress: 0.5,
        lastRead: now,
      });

      // Both records should still exist
      const record1 = await db.readingProgress.get(id1);
      const record2 = await db.readingProgress.get(id2);

      expect(record1).toBeTruthy();
      expect(record2).toBeTruthy();
      expect(record1!.currentSpineIndex).toBe(0);
      expect(record2!.currentSpineIndex).toBe(1);
    });
  });
});
