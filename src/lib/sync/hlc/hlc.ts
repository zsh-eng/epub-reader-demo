/**
 * Hybrid Logical Clock (HLC) Implementation
 *
 * HLC combines physical timestamps with logical counters to provide:
 * - Monotonically increasing timestamps (even if system clock goes backwards)
 * - Causality tracking across distributed systems
 * - Total ordering of events
 *
 * Format: `<timestamp>-<counter>-<deviceId>`
 * Example: `1704067200000-0-a1b2c3d4`
 */

import { getOrCreateDeviceId } from "@/lib/device";

/**
 * Represents the components of an HLC timestamp
 */
export interface HLCState {
  timestamp: number;
  counter: number;
  deviceId: string;
}

/**
 * Service for managing Hybrid Logical Clocks
 */
export interface HLCService {
  /**
   * Generate the next HLC for a local operation.
   * Increments counter if timestamp hasn't changed, resets to 0 if timestamp advanced.
   */
  next(): string;

  /**
   * Update HLC when receiving a remote timestamp.
   * Ensures monotonicity and causality by updating local state if remote is ahead.
   */
  receive(remoteHlc: string): void;

  /**
   * Compare two HLC strings.
   * @returns -1 if a < b, 0 if a == b, 1 if a > b
   */
  compare(a: string, b: string): number;

  /**
   * Parse an HLC string into its components
   */
  parse(hlc: string): HLCState;

  /**
   * Get the current device ID
   */
  getDeviceId(): string;

  /**
   * Get the current HLC state (for debugging/inspection)
   */
  getState(): HLCState;
}

const HLC_STATE_KEY = "epub-reader-hlc-state";

/**
 * Create an HLC service instance.
 *
 * The HLC state is persisted to localStorage to maintain monotonicity
 * across browser sessions.
 *
 * @param deviceId - Optional device ID (defaults to getOrCreateDeviceId())
 * @returns An HLCService instance
 */
export function createHLCService(deviceId?: string): HLCService {
  const _deviceId = deviceId || getOrCreateDeviceId();

  // Load or initialize state
  const state = loadState(_deviceId);

  /**
   * Load HLC state from localStorage, or initialize with current time
   */
  function loadState(devId: string): HLCState {
    try {
      const stored = localStorage.getItem(HLC_STATE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as HLCState;

        // Verify device ID matches
        if (parsed.deviceId === devId) {
          return parsed;
        }
      }
    } catch (error) {
      console.warn("Failed to load HLC state:", error);
    }

    // Initialize with current timestamp
    return {
      timestamp: Date.now(),
      counter: 0,
      deviceId: devId,
    };
  }

  /**
   * Save HLC state to localStorage
   */
  function saveState(): void {
    try {
      localStorage.setItem(HLC_STATE_KEY, JSON.stringify(state));
    } catch (error) {
      console.warn("Failed to save HLC state:", error);
    }
  }

  /**
   * Format HLC state as string
   */
  function format(hlcState: HLCState): string {
    return `${hlcState.timestamp}-${hlcState.counter}-${hlcState.deviceId}`;
  }

  return {
    next(): string {
      const now = Date.now();

      if (now > state.timestamp) {
        // Physical clock advanced - use new timestamp and reset counter
        state.timestamp = now;
        state.counter = 0;
      } else {
        // Physical clock hasn't advanced - increment counter
        state.counter++;
      }

      saveState();
      return format(state);
    },

    receive(remoteHlc: string): void {
      const remote = this.parse(remoteHlc);
      const now = Date.now();

      // Use the maximum of local time, remote time, and current state
      const maxTimestamp = Math.max(now, remote.timestamp, state.timestamp);

      if (maxTimestamp > state.timestamp) {
        // Timestamp advanced - reset counter
        state.timestamp = maxTimestamp;
        state.counter = 0;
      } else if (maxTimestamp === state.timestamp) {
        // Same timestamp - take max counter and increment
        state.counter = Math.max(state.counter, remote.counter) + 1;
      }

      saveState();
    },

    compare(a: string, b: string): number {
      const stateA = this.parse(a);
      const stateB = this.parse(b);

      // Compare timestamps first
      if (stateA.timestamp < stateB.timestamp) return -1;
      if (stateA.timestamp > stateB.timestamp) return 1;

      // Timestamps equal - compare counters
      if (stateA.counter < stateB.counter) return -1;
      if (stateA.counter > stateB.counter) return 1;

      // Both timestamp and counter equal - compare device IDs for deterministic ordering
      if (stateA.deviceId < stateB.deviceId) return -1;
      if (stateA.deviceId > stateB.deviceId) return 1;

      // Completely equal
      return 0;
    },

    parse(hlc: string): HLCState {
      const parts = hlc.split("-");

      if (parts.length < 3) {
        throw new Error(`Invalid HLC format: ${hlc}`);
      }

      const timestamp = parseInt(parts[0], 10);
      const counter = parseInt(parts[1], 10);
      const deviceId = parts.slice(2).join("-"); // Handle UUIDs with hyphens

      if (isNaN(timestamp) || isNaN(counter)) {
        throw new Error(`Invalid HLC format: ${hlc}`);
      }

      return { timestamp, counter, deviceId };
    },

    getDeviceId(): string {
      return _deviceId;
    },

    getState(): HLCState {
      return { ...state };
    },
  };
}

/**
 * Utility function to check if an HLC string is valid
 */
export function isValidHLC(hlc: string): boolean {
  try {
    const parts = hlc.split("-");
    if (parts.length < 3) return false;

    const timestamp = parseInt(parts[0], 10);
    const counter = parseInt(parts[1], 10);

    return !isNaN(timestamp) && !isNaN(counter);
  } catch {
    return false;
  }
}

/**
 * Extract just the timestamp component from an HLC string
 */
export function getHLCTimestamp(hlc: string): number {
  const parts = hlc.split("-");
  if (parts.length < 3) {
    throw new Error(`Invalid HLC format: ${hlc}`);
  }
  return parseInt(parts[0], 10);
}
