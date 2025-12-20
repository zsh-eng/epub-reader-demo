/**
 * Key for storing the device ID in localStorage.
 * The device ID is a UUID that uniquely identifies this browser instance.
 *
 * This is separate from user sessions:
 * - Device ID: Persists forever in localStorage, survives logout/login
 * - Session: Authentication token, rotates on login/logout
 *
 * The device ID is used for:
 * - Tracking reading progress across devices
 * - Conflict resolution in sync (last-write-wins by device)
 * - Displaying "other devices" to the user
 */
const DEVICE_ID_KEY = "epub-reader-device-id";

/**
 * Gets or creates a persistent device ID stored in localStorage.
 * This ID is stable across sessions and used to identify this specific browser/device.
 *
 * The device ID is automatically sent with all API requests via the X-Device-ID header.
 * The server will register/update the device in the database for authenticated users.
 *
 * @returns A UUID string that uniquely identifies this browser instance
 */
export function getOrCreateDeviceId(): string {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}

/**
 * Gets basic device information from the user agent.
 * This is used for display purposes to help users identify their devices.
 */
export function getDeviceInfo() {
  const ua = navigator.userAgent;

  // Detect browser
  let browser = "Unknown";
  if (ua.includes("Chrome") && !ua.includes("Edg")) {
    browser = "Chrome";
  } else if (ua.includes("Safari") && !ua.includes("Chrome")) {
    browser = "Safari";
  } else if (ua.includes("Firefox")) {
    browser = "Firefox";
  } else if (ua.includes("Edg")) {
    browser = "Edge";
  }

  // Detect OS
  let os = "Unknown";
  if (ua.includes("Win")) {
    os = "Windows";
  } else if (ua.includes("Mac")) {
    os = "macOS";
  } else if (ua.includes("Linux")) {
    os = "Linux";
  } else if (ua.includes("Android")) {
    os = "Android";
  } else if (
    ua.includes("iOS") ||
    ua.includes("iPhone") ||
    ua.includes("iPad")
  ) {
    os = "iOS";
  }

  // Detect device type
  let deviceType: "mobile" | "tablet" | "desktop" = "desktop";
  if (ua.includes("Mobile") && !ua.includes("iPad")) {
    deviceType = "mobile";
  } else if (ua.includes("iPad") || ua.includes("Tablet")) {
    deviceType = "tablet";
  }

  // Generate friendly name
  const name = `${browser} on ${os}`;

  return {
    browser,
    os,
    deviceType,
    name,
  };
}

/**
 * Returns the current device ID if it exists, or null if not yet created.
 * This is useful for checking if a device ID exists without creating one.
 *
 * @returns The device ID string or null
 */
export function getDeviceId(): string | null {
  return localStorage.getItem(DEVICE_ID_KEY);
}
