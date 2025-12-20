import * as schema from "@server/db/schema";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

/**
 * Retrieves all devices for a user, sorted by last active date.
 * Marks the current device based on the provided deviceId.
 */
export async function getDevices(
  database: D1Database,
  userId: string,
  currentDeviceId: string,
) {
  const db = drizzle(database, { schema });

  const devices = await db
    .select({
      id: schema.userDevice.id,
      clientId: schema.userDevice.clientId,
      deviceName: schema.userDevice.deviceName,
      browser: schema.userDevice.browser,
      os: schema.userDevice.os,
      deviceType: schema.userDevice.deviceType,
      lastActiveAt: schema.userDevice.lastActiveAt,
      createdAt: schema.userDevice.createdAt,
    })
    .from(schema.userDevice)
    .where(eq(schema.userDevice.userId, userId))
    .orderBy(desc(schema.userDevice.lastActiveAt));

  const devicesWithCurrentFlag = devices.map((device) => ({
    ...device,
    isCurrent: device.clientId === currentDeviceId,
    lastActiveAt: device.lastActiveAt?.toISOString(),
    createdAt: device.createdAt.toISOString(),
  }));

  return devicesWithCurrentFlag;
}
