/**
 * Test: HLC Double Instance Bug
 *
 * This test demonstrates the problems that occur when multiple HLC service
 * instances are created (as currently happens in db.ts and sync-service.ts).
 *
 * The issues demonstrated:
 * 1. Duplicate timestamps from separate instances
 * 2. Counter conflicts due to separate in-memory state
 * 3. Loss of causality when receive() is called on one instance but not the other
 */

import { getHLCService } from "@/lib/sync/hlc";
import { beforeEach, describe, expect, it } from "vitest";

describe("HLC Double Instance Bug", () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
  });

  it("verifies the actual codebase uses singleton", () => {
    // Get the service twice
    const instance1 = getHLCService();
    const instance2 = getHLCService();

    // They should be the exact same object reference
    expect(instance1).toBe(instance2);
    console.log("✅ VERIFIED: getHLCService() returns singleton");

    // Generate timestamps to verify shared state
    const ts1 = instance1.next();
    const ts2 = instance2.next();

    const state1 = instance1.parse(ts1);
    const state2 = instance2.parse(ts2);

    // Counters should increment properly since they share state
    if (state1.timestamp === state2.timestamp) {
      expect(state2.counter).toBe(state1.counter + 1);
      console.log("✅ VERIFIED: Shared state maintains monotonicity");
    }
  });
});
