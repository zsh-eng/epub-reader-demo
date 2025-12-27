/**
 * Position History Utilities
 *
 * Provides utilities for filtering and processing reading progress history
 * to identify "hop-worthy" positions that users can jump back to.
 *
 * Key concepts:
 * - Hop triggers: Navigation actions that create meaningful jump-back points
 * - Deduplication: Collapse consecutive positions in the same chapter
 */

import type { ProgressTriggerType, SyncedReadingProgress } from "@/lib/db";
import { getOrCreateDeviceId } from "@/lib/device";

// Re-export for convenience
export type { ProgressTriggerType } from "@/lib/db";

// ============================================================================
// Types
// ============================================================================

export const HOP_TRIGGERS: ProgressTriggerType[] = [
  "toc-navigation",
  "highlight-jump",
  "fragment-link",
  "manual-chapter",
  "session-start",
];

/**
 * A processed position history entry with device information.
 */
export interface PositionHistoryEntry {
  id: string;
  bookId: string;
  spineIndex: number;
  scrollProgress: number;
  triggerType: ProgressTriggerType;
  targetElementId?: string;
  timestamp: number;
  deviceId: string;
  isCurrentDevice: boolean;
}

// ============================================================================
// Pure Filtering Functions (easily testable)
// ============================================================================

/**
 * Checks if a trigger type represents a "hop" (intentional navigation).
 *
 * @param trigger - The trigger type to check (undefined treated as "periodic")
 * @returns true if this is a hop-worthy trigger
 */
export function isHopTrigger(trigger?: ProgressTriggerType): boolean {
  if (!trigger) return false;
  return HOP_TRIGGERS.includes(trigger);
}

/**
 * Threshold for considering two scroll positions as "same position"
 * within the same chapter. 5% difference = same position.
 */
const SCROLL_PROXIMITY_THRESHOLD = 5;

/**
 * Checks if two positions are effectively the same (same chapter, similar scroll).
 *
 * @param a - First position
 * @param b - Second position
 * @returns true if positions are effectively the same location
 */
export function arePositionsSimilar(
  a: { spineIndex: number; scrollProgress: number },
  b: { spineIndex: number; scrollProgress: number },
): boolean {
  if (a.spineIndex !== b.spineIndex) return false;
  return Math.abs(a.scrollProgress - b.scrollProgress) < SCROLL_PROXIMITY_THRESHOLD;
}

/**
 * Filters progress records to only include hop-worthy entries.
 *
 * @param records - Raw reading progress records
 * @returns Records that have hop-worthy trigger types
 */
export function filterHopWorthyRecords<
  T extends { triggerType?: ProgressTriggerType },
>(records: T[]): T[] {
  return records.filter((record) => isHopTrigger(record.triggerType));
}

/**
 * Deduplicates consecutive positions that are in the same chapter and similar scroll.
 * Keeps the most recent entry when duplicates are found.
 *
 * For example, with positions [A, B, B', C, B''] where B, B', B'' are similar:
 * - Result: [A, B, C, B''] (keeps first B, skips B', keeps C, keeps B'' as it's not consecutive)
 *
 * @param entries - Position history entries (assumed sorted newest first)
 * @returns Deduplicated entries
 */
export function deduplicateConsecutivePositions<
  T extends { spineIndex: number; scrollProgress: number },
>(entries: T[]): T[] {
  if (entries.length <= 1) return entries;

  const result: T[] = [entries[0]];

  for (let i = 1; i < entries.length; i++) {
    const current = entries[i];
    const previous = result[result.length - 1];

    // Only add if significantly different from the last kept position
    if (!arePositionsSimilar(current, previous)) {
      result.push(current);
    }
  }

  return result;
}

/**
 * Transforms raw reading progress records into position history entries
 * with device information.
 *
 * @param records - Raw synced reading progress records
 * @param currentDeviceId - The current device's ID
 * @returns Transformed position history entries
 */
export function transformToHistoryEntries(
  records: SyncedReadingProgress[],
  currentDeviceId: string,
): PositionHistoryEntry[] {
  return records.map((record) => ({
    id: record.id,
    bookId: record.bookId,
    spineIndex: record.currentSpineIndex,
    scrollProgress: record.scrollProgress,
    triggerType: (record.triggerType as ProgressTriggerType) || "periodic",
    targetElementId: record.targetElementId,
    timestamp: record.lastRead,
    deviceId: record._deviceId,
    isCurrentDevice: record._deviceId === currentDeviceId,
  }));
}

// ============================================================================
// Main Processing Function
// ============================================================================

/**
 * Processes raw reading progress history into a filtered, deduplicated
 * list of hop-worthy positions for the jump-back UI.
 *
 * Pipeline:
 * 1. Filter to hop-worthy triggers only
 * 2. Transform to history entries with device info
 * 3. Deduplicate consecutive similar positions
 * 4. Limit to requested count
 *
 * @param records - Raw synced reading progress records (newest first)
 * @param limit - Maximum number of entries to return
 * @returns Processed position history entries
 */
export function processPositionHistory(
  records: SyncedReadingProgress[],
  limit: number = 10,
): PositionHistoryEntry[] {
  const currentDeviceId = getOrCreateDeviceId();

  // Step 1: Filter to hop-worthy only
  const hopRecords = filterHopWorthyRecords(records);

  // Step 2: Transform to history entries
  const entries = transformToHistoryEntries(hopRecords, currentDeviceId);

  // Step 3: Deduplicate consecutive similar positions
  const deduplicated = deduplicateConsecutivePositions(entries);

  // Step 4: Limit
  return deduplicated.slice(0, limit);
}
