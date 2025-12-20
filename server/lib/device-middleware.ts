import * as schema from "@server/db/schema";
import type { User } from "better-auth/types";
import { drizzle } from "drizzle-orm/d1";
import type { MiddlewareHandler } from "hono";
import { UAParser } from "ua-parser-js";

/**
 * Middleware that extracts the device ID from request headers and registers/updates
 * the device in the database. This runs for authenticated users only.
 *
 * The device is created with ON CONFLICT DO NOTHING semantics - we just ensure it exists.
 * We update lastActiveAt on each request to track device usage.
 */
export const deviceMiddleware: MiddlewareHandler<{
  Bindings: Env;
  Variables: {
    user: User | undefined;
    deviceId: string | undefined;
  };
}> = async (c, next) => {
  const deviceId = c.req.header("X-Device-ID");
  const user = c.get("user");

  // Store device ID in context for use by route handlers
  c.set("deviceId", deviceId);

  // Only register device if we have both a device ID and authenticated user
  if (!deviceId || !user) {
    await next();
    return;
  }

  const db = drizzle(c.env.DATABASE, { schema });
  const userAgent = c.req.header("User-Agent");

  // Parse device info from user agent
  const deviceInfo = parseDeviceInfo(userAgent);

  try {
    const now = Date.now();

    // Use ON CONFLICT to atomically upsert device record
    // This eliminates race conditions by handling everything in a single query
    await db
      .insert(schema.userDevice)
      .values({
        id: crypto.randomUUID(),
        userId: user.id,
        clientId: deviceId,
        deviceName: deviceInfo.name,
        browser: deviceInfo.browser,
        os: deviceInfo.os,
        deviceType: deviceInfo.deviceType,
        lastActiveAt: new Date(now),
      })
      .onConflictDoUpdate({
        target: [schema.userDevice.userId, schema.userDevice.clientId],
        set: {
          lastActiveAt: new Date(now),
        },
      });
  } catch (error) {
    // Log error but don't block the request
    console.error("Failed to register device:", error);
  }

  await next();
};

/**
 * Parse device information from user agent string
 */
function parseDeviceInfo(userAgent: string | null | undefined) {
  if (!userAgent) {
    return {
      browser: "Unknown",
      os: "Unknown",
      deviceType: "desktop",
      name: "Unknown Device",
    };
  }

  const parser = new UAParser(userAgent);
  const result = parser.getResult();

  const browser = result.browser.name || "Unknown";
  const os = result.os.name || "Unknown";
  const deviceType = (result.device.type || "desktop") as string;
  const name = `${browser} on ${os}`;

  return {
    browser,
    os,
    deviceType,
    name,
  };
}
