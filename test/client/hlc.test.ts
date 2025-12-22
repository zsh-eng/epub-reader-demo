import { beforeEach, describe, expect, it } from "vitest";
import {
  createHLCService,
  getHLCTimestamp,
  isValidHLC,
  type HLCService,
} from "../../src/lib/sync/hlc/hlc";

describe("HLC Service", () => {
  let hlc: HLCService;
  const testDeviceId = "test-device-123";

  beforeEach(() => {
    // Clear localStorage before each test
    // localStorage.clear();

    // Create a new HLC service with a test device ID
    hlc = createHLCService(testDeviceId);
  });

  describe("nextBatch()", () => {
    it("should generate multiple valid HLC timestamps", () => {
      const timestamps = hlc.nextBatch(5);

      expect(timestamps).toHaveLength(5);

      // All should be valid
      timestamps.forEach((ts) => {
        expect(isValidHLC(ts)).toBe(true);
        expect(ts).toContain(testDeviceId);
      });
    });

    it("should generate monotonically increasing timestamps", () => {
      const timestamps = hlc.nextBatch(10);

      // Each timestamp should be >= the previous one
      for (let i = 1; i < timestamps.length; i++) {
        const comparison = hlc.compare(timestamps[i - 1], timestamps[i]);
        expect(comparison).toBe(-1); // Should be strictly less than (monotonically increasing)
      }
    });

    it("should increment counter for each timestamp in the batch", () => {
      const timestamps = hlc.nextBatch(5);

      const states = timestamps.map((ts) => hlc.parse(ts));

      // All timestamps in the batch should have the same physical timestamp
      const firstTimestamp = states[0].timestamp;
      states.forEach((state) => {
        expect(state.timestamp).toBe(firstTimestamp);
      });

      // Counters should increment
      for (let i = 1; i < states.length; i++) {
        expect(states[i].counter).toBe(states[i - 1].counter + 1);
      }
    });

    it("should handle empty batch request", () => {
      const timestamps = hlc.nextBatch(0);
      expect(timestamps).toEqual([]);
    });

    it("should handle negative count", () => {
      const timestamps = hlc.nextBatch(-5);
      expect(timestamps).toEqual([]);
    });

    it("should handle single item batch", () => {
      const timestamps = hlc.nextBatch(1);
      expect(timestamps).toHaveLength(1);
      expect(isValidHLC(timestamps[0])).toBe(true);
    });

    it("should generate large batches efficiently", () => {
      const count = 1000;
      const timestamps = hlc.nextBatch(count);

      expect(timestamps).toHaveLength(count);

      // Verify monotonicity
      for (let i = 1; i < timestamps.length; i++) {
        expect(hlc.compare(timestamps[i - 1], timestamps[i])).toBe(-1);
      }

      // All should be unique
      const uniqueSet = new Set(timestamps);
      expect(uniqueSet.size).toBe(count);
    });

    it("should maintain monotonicity across batch and next() calls", () => {
      const ts1 = hlc.next();
      const batch = hlc.nextBatch(3);
      const ts2 = hlc.next();

      // ts1 < all batch timestamps
      batch.forEach((ts) => {
        expect(hlc.compare(ts1, ts)).toBe(-1);
      });

      // all batch timestamps < ts2
      batch.forEach((ts) => {
        expect(hlc.compare(ts, ts2)).toBe(-1);
      });
    });

    it("should persist state after batch generation", () => {
      const batch = hlc.nextBatch(5);
      const lastBatchTs = batch[batch.length - 1];
      const lastState = hlc.parse(lastBatchTs);

      // Create a new HLC service (simulating page reload)
      const hlc2 = createHLCService(testDeviceId);
      const loadedState = hlc2.getState();

      expect(loadedState.timestamp).toBe(lastState.timestamp);
      expect(loadedState.counter).toBe(lastState.counter);
    });

    it("should continue from correct counter after batch", () => {
      const batch = hlc.nextBatch(3);
      const lastBatchState = hlc.parse(batch[batch.length - 1]);

      const nextTs = hlc.next();
      const nextState = hlc.parse(nextTs);

      // Should continue incrementing counter
      if (nextState.timestamp === lastBatchState.timestamp) {
        expect(nextState.counter).toBe(lastBatchState.counter + 1);
      }
    });

    it("should reset counter when physical time advances during batch", async () => {
      // Generate initial batch
      hlc.nextBatch(3);

      // Wait for time to advance
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Generate another batch
      const batch2 = hlc.nextBatch(3);
      const states = batch2.map((ts) => hlc.parse(ts));

      // First item in new batch should have counter 0
      expect(states[0].counter).toBe(0);

      // Subsequent items should increment
      for (let i = 1; i < states.length; i++) {
        expect(states[i].counter).toBe(i);
      }
    });

    it("should handle interleaved batch and single next() calls", () => {
      const ts1 = hlc.next();
      const batch1 = hlc.nextBatch(2);
      const ts2 = hlc.next();
      const batch2 = hlc.nextBatch(2);
      const ts3 = hlc.next();

      const allTimestamps = [ts1, ...batch1, ts2, ...batch2, ts3];

      // All should be monotonically increasing
      for (let i = 1; i < allTimestamps.length; i++) {
        expect(hlc.compare(allTimestamps[i - 1], allTimestamps[i])).toBe(-1);
      }
    });

    it("should generate unique timestamps in batch", () => {
      const batch = hlc.nextBatch(100);
      const uniqueSet = new Set(batch);
      expect(uniqueSet.size).toBe(100);
    });
  });

  describe("next()", () => {
    it("should generate a valid HLC timestamp", () => {
      const timestamp = hlc.next();

      expect(typeof timestamp).toBe("string");
      expect(isValidHLC(timestamp)).toBe(true);
      expect(timestamp).toContain(testDeviceId);
    });

    it("should increment counter when called multiple times in quick succession", () => {
      const ts1 = hlc.next();
      const ts2 = hlc.next();
      const ts3 = hlc.next();

      const state1 = hlc.parse(ts1);
      const state2 = hlc.parse(ts2);
      const state3 = hlc.parse(ts3);

      // Counter should increment if timestamps are the same
      if (state1.timestamp === state2.timestamp) {
        expect(state2.counter).toBeGreaterThan(state1.counter);
      }

      if (state2.timestamp === state3.timestamp) {
        expect(state3.counter).toBeGreaterThan(state2.counter);
      }

      // All should have the same device ID
      expect(state1.deviceId).toBe(testDeviceId);
      expect(state2.deviceId).toBe(testDeviceId);
      expect(state3.deviceId).toBe(testDeviceId);
    });

    it("should reset counter when physical time advances", async () => {
      const ts1 = hlc.next();
      const state1 = hlc.parse(ts1);

      // Wait for time to advance (at least 1ms)
      await new Promise((resolve) => setTimeout(resolve, 10));

      const ts2 = hlc.next();
      const state2 = hlc.parse(ts2);

      expect(state2.timestamp).toBeGreaterThan(state1.timestamp);
      expect(state2.counter).toBe(0); // Counter resets when timestamp advances
    });

    it("should maintain monotonicity", () => {
      const timestamps: string[] = [];

      // Generate many timestamps quickly
      for (let i = 0; i < 100; i++) {
        timestamps.push(hlc.next());
      }

      // Each timestamp should be >= the previous one
      for (let i = 1; i < timestamps.length; i++) {
        const comparison = hlc.compare(timestamps[i - 1], timestamps[i]);
        expect(comparison).toBeLessThanOrEqual(0); // -1 or 0 (less than or equal)
      }
    });

    it("should persist state to localStorage", () => {
      const ts1 = hlc.next();
      const state1 = hlc.parse(ts1);

      // Create a new HLC service instance (simulating page reload)
      const hlc2 = createHLCService(testDeviceId);
      const loadedState = hlc2.getState();

      expect(loadedState.timestamp).toBe(state1.timestamp);
      expect(loadedState.counter).toBe(state1.counter);
      expect(loadedState.deviceId).toBe(testDeviceId);
    });
  });

  describe("receive()", () => {
    it("should update local clock when receiving a higher timestamp", () => {
      const localTs = hlc.next();
      const _localState = hlc.parse(localTs);

      // Create a remote timestamp with a higher time
      const futureTime = Date.now() + 10000;
      const remoteTs = `${futureTime}-0-remote-device`;

      hlc.receive(remoteTs);
      const updatedState = hlc.getState();

      expect(updatedState.timestamp).toBeGreaterThanOrEqual(futureTime);
    });

    it("should increment counter when receiving same timestamp", () => {
      const ts1 = hlc.next();
      const state1 = hlc.parse(ts1);

      // Create a remote timestamp with same time but different counter
      const remoteTs = `${state1.timestamp}-5-remote-device`;

      hlc.receive(remoteTs);

      const nextTs = hlc.next();
      const nextState = hlc.parse(nextTs);

      // If timestamp is still the same, counter should be > 5
      if (nextState.timestamp === state1.timestamp) {
        expect(nextState.counter).toBeGreaterThan(5);
      }
    });

    it("should maintain causality after receiving remote timestamp", () => {
      const ts1 = hlc.next();

      // Receive a remote timestamp
      const remoteTs = `${Date.now() + 5000}-10-remote-device`;
      hlc.receive(remoteTs);

      const ts2 = hlc.next();

      // ts2 must be greater than both ts1 and remoteTs
      expect(hlc.compare(ts1, ts2)).toBeLessThan(0);
      expect(hlc.compare(remoteTs, ts2)).toBeLessThanOrEqual(0);
    });

    it("should handle multiple remote timestamps", () => {
      const remote1 = `${Date.now() + 1000}-0-device1`;
      const remote2 = `${Date.now() + 2000}-0-device2`;
      const remote3 = `${Date.now() + 1500}-5-device3`;

      hlc.receive(remote1);
      hlc.receive(remote2);
      hlc.receive(remote3);

      const nextTs = hlc.next();

      // Next timestamp should be greater than all received timestamps
      expect(hlc.compare(remote1, nextTs)).toBeLessThan(0);
      expect(hlc.compare(remote2, nextTs)).toBeLessThanOrEqual(0);
      expect(hlc.compare(remote3, nextTs)).toBeLessThan(0);
    });
  });

  describe("compare()", () => {
    it("should correctly compare timestamps with different times", () => {
      const ts1 = "1000-0-device1";
      const ts2 = "2000-0-device2";

      expect(hlc.compare(ts1, ts2)).toBe(-1);
      expect(hlc.compare(ts2, ts1)).toBe(1);
    });

    it("should correctly compare timestamps with same time but different counters", () => {
      const ts1 = "1000-5-device1";
      const ts2 = "1000-10-device2";

      expect(hlc.compare(ts1, ts2)).toBe(-1);
      expect(hlc.compare(ts2, ts1)).toBe(1);
    });

    it("should correctly compare timestamps with same time and counter", () => {
      const ts1 = "1000-5-device-a";
      const ts2 = "1000-5-device-b";

      const result = hlc.compare(ts1, ts2);

      // Should use device ID for tie-breaking (lexicographic order)
      expect(result).toBe(-1); // 'device-a' < 'device-b'
      expect(hlc.compare(ts2, ts1)).toBe(1);
    });

    it("should return 0 for identical timestamps", () => {
      const ts = "1000-5-device1";

      expect(hlc.compare(ts, ts)).toBe(0);
    });

    it("should provide total ordering", () => {
      const timestamps = [
        "3000-0-device1",
        "1000-10-device2",
        "2000-0-device3",
        "1000-5-device1",
        "1000-10-device1",
      ];

      // Sort using compare
      const sorted = [...timestamps].sort((a, b) => hlc.compare(a, b));

      // Verify order
      expect(sorted[0]).toBe("1000-5-device1");
      expect(sorted[1]).toBe("1000-10-device1");
      expect(sorted[2]).toBe("1000-10-device2");
      expect(sorted[3]).toBe("2000-0-device3");
      expect(sorted[4]).toBe("3000-0-device1");
    });
  });

  describe("parse()", () => {
    it("should correctly parse valid HLC string", () => {
      const hlcString = "1704067200000-42-test-device-uuid";
      const state = hlc.parse(hlcString);

      expect(state.timestamp).toBe(1704067200000);
      expect(state.counter).toBe(42);
      expect(state.deviceId).toBe("test-device-uuid");
    });

    it("should handle device IDs with hyphens (UUIDs)", () => {
      const hlcString = "1704067200000-0-a1b2c3d4-e5f6-7890-abcd-ef1234567890";
      const state = hlc.parse(hlcString);

      expect(state.timestamp).toBe(1704067200000);
      expect(state.counter).toBe(0);
      expect(state.deviceId).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    });

    it("should throw error for invalid format", () => {
      expect(() => hlc.parse("invalid")).toThrow("Invalid HLC format");
      expect(() => hlc.parse("1000-5")).toThrow("Invalid HLC format");
      expect(() => hlc.parse("abc-def-ghi")).toThrow("Invalid HLC format");
    });

    it("should throw error for non-numeric timestamp or counter", () => {
      expect(() => hlc.parse("abc-5-device")).toThrow("Invalid HLC format");
      expect(() => hlc.parse("1000-abc-device")).toThrow("Invalid HLC format");
    });
  });

  describe("getDeviceId()", () => {
    it("should return the device ID", () => {
      expect(hlc.getDeviceId()).toBe(testDeviceId);
    });

    it("should return consistent device ID", () => {
      const id1 = hlc.getDeviceId();
      const id2 = hlc.getDeviceId();

      expect(id1).toBe(id2);
      expect(id1).toBe(testDeviceId);
    });
  });

  describe("getState()", () => {
    it("should return current state", () => {
      const ts = hlc.next();
      const parsedState = hlc.parse(ts);
      const currentState = hlc.getState();

      expect(currentState.timestamp).toBe(parsedState.timestamp);
      expect(currentState.counter).toBe(parsedState.counter);
      expect(currentState.deviceId).toBe(parsedState.deviceId);
    });

    it("should return a copy of state (not mutable reference)", () => {
      const state1 = hlc.getState();
      state1.counter = 999999;

      const state2 = hlc.getState();
      expect(state2.counter).not.toBe(999999);
    });
  });

  describe("localStorage persistence", () => {
    it("should load state from localStorage on initialization", () => {
      // Generate some timestamps
      hlc.next();
      hlc.next();
      const lastTs = hlc.next();
      const lastState = hlc.parse(lastTs);

      // Create new HLC service (simulates page reload)
      const hlc2 = createHLCService(testDeviceId);
      const loadedState = hlc2.getState();

      expect(loadedState.timestamp).toBe(lastState.timestamp);
      expect(loadedState.counter).toBe(lastState.counter);
      expect(loadedState.deviceId).toBe(testDeviceId);
    });

    it("should initialize with current time if no stored state", () => {
      localStorage.clear();

      const now = Date.now();
      const freshHlc = createHLCService("fresh-device");
      const state = freshHlc.getState();

      expect(state.timestamp).toBeGreaterThanOrEqual(now);
      expect(state.counter).toBe(0);
      expect(state.deviceId).toBe("fresh-device");
    });

    it("should ignore stored state with different device ID", () => {
      // Store state for different device
      const otherHlc = createHLCService("other-device");
      otherHlc.next();

      // Create HLC with different device ID
      const newHlc = createHLCService("new-device");
      const state = newHlc.getState();

      expect(state.deviceId).toBe("new-device");
      expect(state.counter).toBe(0); // Should reset, not inherit from other device
    });

    it("should handle corrupted localStorage data gracefully", () => {
      // Corrupt the stored state
      localStorage.setItem("epub-reader-hlc-state", "invalid json");

      // Should not throw, should initialize fresh
      expect(() => createHLCService(testDeviceId)).not.toThrow();

      const hlc = createHLCService(testDeviceId);
      const state = hlc.getState();

      expect(state.deviceId).toBe(testDeviceId);
      expect(state.counter).toBe(0);
    });
  });

  describe("Utility functions", () => {
    describe("isValidHLC()", () => {
      it("should return true for valid HLC strings", () => {
        expect(isValidHLC("1000-0-device")).toBe(true);
        expect(isValidHLC("1704067200000-42-a1b2c3d4")).toBe(true);
        expect(isValidHLC("999-999-my-device-id")).toBe(true);
      });

      it("should return false for invalid HLC strings", () => {
        expect(isValidHLC("invalid")).toBe(false);
        expect(isValidHLC("1000-5")).toBe(false);
        expect(isValidHLC("abc-def-ghi")).toBe(false);
        expect(isValidHLC("")).toBe(false);
        expect(isValidHLC("1000")).toBe(false);
      });
    });

    describe("getHLCTimestamp()", () => {
      it("should extract timestamp from HLC string", () => {
        expect(getHLCTimestamp("1704067200000-0-device")).toBe(1704067200000);
        expect(getHLCTimestamp("999-42-device")).toBe(999);
      });

      it("should throw error for invalid HLC format", () => {
        expect(() => getHLCTimestamp("invalid")).toThrow("Invalid HLC format");
        expect(() => getHLCTimestamp("1000-5")).toThrow("Invalid HLC format");
      });
    });
  });

  describe("Edge cases and stress tests", () => {
    it("should handle rapid-fire timestamp generation", () => {
      const timestamps: string[] = [];
      const count = 1000;

      for (let i = 0; i < count; i++) {
        timestamps.push(hlc.next());
      }

      // All should be unique or monotonically increasing
      const uniqueSet = new Set(timestamps);
      expect(uniqueSet.size).toBe(count);

      // Verify monotonicity
      for (let i = 1; i < timestamps.length; i++) {
        expect(
          hlc.compare(timestamps[i - 1], timestamps[i]),
        ).toBeLessThanOrEqual(0);
      }
    });

    it("should handle very large counter values", () => {
      // Simulate a scenario where counter gets very large
      for (let i = 0; i < 10000; i++) {
        hlc.next();
      }

      const ts = hlc.next();
      expect(isValidHLC(ts)).toBe(true);

      const state = hlc.parse(ts);
      expect(state.counter).toBeGreaterThan(0);
    });

    it("should handle timestamps from far future", () => {
      const farFuture = Date.now() + 365 * 24 * 60 * 60 * 1000; // 1 year in future
      const futureTs = `${farFuture}-0-future-device`;

      hlc.receive(futureTs);
      const nextTs = hlc.next();

      expect(hlc.compare(futureTs, nextTs)).toBeLessThanOrEqual(0);
    });

    it("should handle timestamps from past", () => {
      const currentTs = hlc.next();
      const pastTs = `1000-0-past-device`;

      hlc.receive(pastTs);
      const nextTs = hlc.next();

      // Current time should be used, not past time
      expect(hlc.compare(currentTs, nextTs)).toBeLessThanOrEqual(0);
      expect(hlc.compare(nextTs, pastTs)).toBeGreaterThan(0);
    });
  });
});
