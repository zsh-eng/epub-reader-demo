import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestUser } from "./helpers";

describe("GET /api/devices", () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>;
  const deviceId1 = "test-device-id-001";
  const deviceId2 = "test-device-id-002";

  beforeAll(async () => {
    testUser = await createTestUser(
      "devicetest@example.com",
      "testpassword123",
      "Device Test User",
    );
  });

  it("returns devices for authenticated user with device ID header", async () => {
    const response = await SELF.fetch("http://example.com/api/devices", {
      headers: {
        Cookie: testUser.sessionCookie,
        "X-Device-ID": deviceId1,
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const data = await response.json();
    expect(data.devices).toBeDefined();
    expect(Array.isArray(data.devices)).toBe(true);
    expect(data.devices.length).toBeGreaterThan(0);

    // Verify the current device is marked correctly
    const currentDevice = data.devices.find((d: any) => d.isCurrent);
    expect(currentDevice).toBeDefined();
    expect(currentDevice.clientId).toBe(deviceId1);
    expect(currentDevice.deviceName).toBeDefined();
    expect(currentDevice.browser).toBeDefined();
    expect(currentDevice.os).toBeDefined();
    expect(currentDevice.lastActiveAt).toBeDefined();
    expect(currentDevice.createdAt).toBeDefined();
  });

  it("tracks multiple devices for the same user", async () => {
    // First, make a request with deviceId1 to ensure it exists
    await SELF.fetch("http://example.com/api/devices", {
      headers: {
        Cookie: testUser.sessionCookie,
        "X-Device-ID": deviceId1,
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });

    // Now make a request with a different device ID
    const response1 = await SELF.fetch("http://example.com/api/devices", {
      headers: {
        Cookie: testUser.sessionCookie,
        "X-Device-ID": deviceId2,
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15",
      },
    });

    expect(response1.status).toBe(200);

    const data1 = await response1.json();
    expect(data1.devices.length).toBeGreaterThanOrEqual(2);

    // Verify the second device is now current
    const currentDevice = data1.devices.find((d: any) => d.isCurrent);
    expect(currentDevice.clientId).toBe(deviceId2);

    // Make another request with the first device ID
    const response2 = await SELF.fetch("http://example.com/api/devices", {
      headers: {
        Cookie: testUser.sessionCookie,
        "X-Device-ID": deviceId1,
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });

    const data2 = await response2.json();
    expect(data2.devices.length).toBeGreaterThanOrEqual(2);

    // Verify the first device is now current again
    const currentDevice2 = data2.devices.find((d: any) => d.isCurrent);
    expect(currentDevice2.clientId).toBe(deviceId1);

    // Verify both devices exist in the list
    const device1 = data2.devices.find((d: any) => d.clientId === deviceId1);
    const device2 = data2.devices.find((d: any) => d.clientId === deviceId2);
    expect(device1).toBeDefined();
    expect(device2).toBeDefined();
  });

  it("returns 401 when no device ID header is provided", async () => {
    const response = await SELF.fetch("http://example.com/api/devices", {
      headers: {
        Cookie: testUser.sessionCookie,
      },
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");

    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 401 when user is not authenticated", async () => {
    const response = await SELF.fetch("http://example.com/api/devices", {
      headers: {
        "X-Device-ID": deviceId1,
      },
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");

    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 401 when user is not authenticated and no device ID is provided", async () => {
    const response = await SELF.fetch("http://example.com/api/devices");

    expect(response.status).toBe(401);

    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 401 for requests with invalid session cookie", async () => {
    const response = await SELF.fetch("http://example.com/api/devices", {
      headers: {
        Cookie: "better-auth.session_token=invalid-token-123",
        "X-Device-ID": deviceId1,
      },
    });

    expect(response.status).toBe(401);

    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("orders devices by lastActiveAt descending", async () => {
    // Make requests with different devices to ensure ordering
    await SELF.fetch("http://example.com/api/devices", {
      headers: {
        Cookie: testUser.sessionCookie,
        "X-Device-ID": deviceId1,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      },
    });

    // Small delay to ensure different timestamps
    await new Promise((resolve) => setTimeout(resolve, 10));

    await SELF.fetch("http://example.com/api/devices", {
      headers: {
        Cookie: testUser.sessionCookie,
        "X-Device-ID": deviceId2,
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0)",
      },
    });

    const response = await SELF.fetch("http://example.com/api/devices", {
      headers: {
        Cookie: testUser.sessionCookie,
        "X-Device-ID": deviceId2,
      },
    });

    const data = await response.json();

    // Verify devices are ordered by lastActiveAt (most recent first)
    for (let i = 0; i < data.devices.length - 1; i++) {
      const current = new Date(data.devices[i].lastActiveAt);
      const next = new Date(data.devices[i + 1].lastActiveAt);
      expect(current.getTime()).toBeGreaterThanOrEqual(next.getTime());
    }
  });
});
