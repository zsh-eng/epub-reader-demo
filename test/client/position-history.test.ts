/**
 * Tests for Position History Utilities
 *
 * Tests the pure functions for filtering hop-worthy positions,
 * deduplicating consecutive entries, and processing position history.
 */

import {
  arePositionsSimilar,
  deduplicateConsecutivePositions,
  filterHopWorthyRecords,
  HOP_TRIGGERS,
  isHopTrigger,
  type PositionHistoryEntry,
  type ProgressTriggerType,
} from "@/lib/position-history";
import { describe, expect, it } from "vitest";

describe("Position History Utilities", () => {
  describe("isHopTrigger", () => {
    it("should return true for hop-worthy triggers", () => {
      for (const trigger of HOP_TRIGGERS) {
        expect(isHopTrigger(trigger)).toBe(true);
      }
    });

    it("should return false for periodic trigger", () => {
      expect(isHopTrigger("periodic")).toBe(false);
    });

    it("should return false for undefined", () => {
      expect(isHopTrigger(undefined)).toBe(false);
    });
  });

  describe("arePositionsSimilar", () => {
    it("should return true for same chapter and similar scroll", () => {
      expect(
        arePositionsSimilar(
          { spineIndex: 5, scrollProgress: 50 },
          { spineIndex: 5, scrollProgress: 52 },
        ),
      ).toBe(true);
    });

    it("should return false for different chapters", () => {
      expect(
        arePositionsSimilar(
          { spineIndex: 5, scrollProgress: 50 },
          { spineIndex: 6, scrollProgress: 50 },
        ),
      ).toBe(false);
    });

    it("should return false for same chapter but distant scroll", () => {
      expect(
        arePositionsSimilar(
          { spineIndex: 5, scrollProgress: 10 },
          { spineIndex: 5, scrollProgress: 50 },
        ),
      ).toBe(false);
    });

    it("should handle edge cases at 0% and 100%", () => {
      expect(
        arePositionsSimilar(
          { spineIndex: 0, scrollProgress: 0 },
          { spineIndex: 0, scrollProgress: 3 },
        ),
      ).toBe(true);

      expect(
        arePositionsSimilar(
          { spineIndex: 0, scrollProgress: 97 },
          { spineIndex: 0, scrollProgress: 100 },
        ),
      ).toBe(true);
    });
  });

  describe("filterHopWorthyRecords", () => {
    it("should filter to only hop-worthy triggers", () => {
      const records = [
        { id: "1", triggerType: "periodic" as ProgressTriggerType },
        { id: "2", triggerType: "toc-navigation" as ProgressTriggerType },
        { id: "3", triggerType: "periodic" as ProgressTriggerType },
        { id: "4", triggerType: "highlight-jump" as ProgressTriggerType },
      ];

      const result = filterHopWorthyRecords(records);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("2");
      expect(result[1].id).toBe("4");
    });

    it("should treat undefined triggerType as non-hop", () => {
      const records = [
        { id: "1", triggerType: undefined },
        { id: "2", triggerType: "session-start" as ProgressTriggerType },
      ];

      const result = filterHopWorthyRecords(records);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("2");
    });

    it("should return empty array when no hop triggers", () => {
      const records = [
        { id: "1", triggerType: "periodic" as ProgressTriggerType },
        { id: "2", triggerType: undefined },
      ];

      expect(filterHopWorthyRecords(records)).toHaveLength(0);
    });
  });

  describe("deduplicateConsecutivePositions", () => {
    it("should remove consecutive similar positions", () => {
      const entries = [
        { spineIndex: 5, scrollProgress: 50 },
        { spineIndex: 5, scrollProgress: 51 }, // Similar to previous
        { spineIndex: 5, scrollProgress: 52 }, // Similar to previous
        { spineIndex: 3, scrollProgress: 20 }, // Different chapter
      ];

      const result = deduplicateConsecutivePositions(entries);

      expect(result).toHaveLength(2);
      expect(result[0].spineIndex).toBe(5);
      expect(result[1].spineIndex).toBe(3);
    });

    it("should keep non-consecutive similar positions", () => {
      // Positions: A -> B -> A (return to A)
      const entries = [
        { spineIndex: 5, scrollProgress: 50 }, // A
        { spineIndex: 3, scrollProgress: 20 }, // B
        { spineIndex: 5, scrollProgress: 51 }, // A again (not consecutive)
      ];

      const result = deduplicateConsecutivePositions(entries);

      expect(result).toHaveLength(3);
    });

    it("should handle single entry", () => {
      const entries = [{ spineIndex: 5, scrollProgress: 50 }];

      expect(deduplicateConsecutivePositions(entries)).toHaveLength(1);
    });

    it("should handle empty array", () => {
      expect(deduplicateConsecutivePositions([])).toHaveLength(0);
    });

    it("should preserve additional properties", () => {
      const entries: PositionHistoryEntry[] = [
        {
          id: "1",
          bookId: "book1",
          spineIndex: 5,
          scrollProgress: 50,
          triggerType: "toc-navigation",
          timestamp: 1000,
          deviceId: "device1",
          isCurrentDevice: true,
        },
        {
          id: "2",
          bookId: "book1",
          spineIndex: 5,
          scrollProgress: 51,
          triggerType: "fragment-link",
          timestamp: 2000,
          deviceId: "device1",
          isCurrentDevice: true,
        },
      ];

      const result = deduplicateConsecutivePositions(entries);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("1"); // Keeps first entry
      expect(result[0].triggerType).toBe("toc-navigation");
    });
  });

  describe("Integration: position history flow", () => {
    it("should handle realistic navigation pattern", () => {
      // Simulate: session start -> read -> TOC jump -> read -> highlight jump -> return
      const entries = [
        { spineIndex: 0, scrollProgress: 0 }, // session-start (hop)
        { spineIndex: 0, scrollProgress: 25 }, // periodic (filtered out before this)
        { spineIndex: 0, scrollProgress: 50 }, // periodic
        { spineIndex: 5, scrollProgress: 0 }, // toc-navigation (hop)
        { spineIndex: 5, scrollProgress: 30 }, // periodic
        { spineIndex: 8, scrollProgress: 75 }, // highlight-jump (hop)
        { spineIndex: 5, scrollProgress: 30 }, // return via jump-back (hop)
      ];

      // Assuming only hop entries make it here (pre-filtered)
      const hopEntries = [
        entries[0], // session-start
        entries[3], // toc-navigation
        entries[5], // highlight-jump
        entries[6], // return
      ];

      const result = deduplicateConsecutivePositions(hopEntries);

      // All positions are different chapters or non-consecutive returns
      expect(result).toHaveLength(4);
    });
  });
});
