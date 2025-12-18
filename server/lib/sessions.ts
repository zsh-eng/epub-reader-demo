import * as schema from "@server/db/auth-schema";
import type { Session, User } from "better-auth/types";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { UAParser } from "ua-parser-js";

// Helper function to parse user agent and extract relevant info
function parseUserAgent(userAgent: string | null) {
  if (!userAgent) {
    return {
      browser: { name: "Unknown", version: "" },
      os: { name: "Unknown", version: "" },
      device: { type: "desktop" as const },
    };
  }

  const parser = new UAParser(userAgent);
  const result = parser.getResult();

  return {
    browser: {
      name: result.browser.name || "Unknown",
      version: result.browser.version || "",
    },
    os: {
      name: result.os.name || "Unknown",
      version: result.os.version || "",
    },
    device: {
      type: (result.device.type || "desktop") as
        | "mobile"
        | "tablet"
        | "desktop",
    },
  };
}

export async function getActiveSessions(
  env: Env,
  currentSession: Session,
  user: User,
) {
  const db = drizzle(env.DATABASE, { schema });

  // Fetch all active sessions for the user (not expired)
  const sessions = await db
    .select({
      id: schema.session.id,
      userAgent: schema.session.userAgent,
      ipAddress: schema.session.ipAddress,
      createdAt: schema.session.createdAt,
      updatedAt: schema.session.updatedAt,
      expiresAt: schema.session.expiresAt,
    })
    .from(schema.session)
    .where(eq(schema.session.userId, user.id));

  // Filter to only active sessions and parse user agent
  const now = new Date();
  const activeSessions = sessions
    .filter((session) => session.expiresAt > now)
    .map((session) => {
      const parsedUA = parseUserAgent(session.userAgent);
      return {
        id: session.id,
        browser: parsedUA.browser,
        os: parsedUA.os,
        deviceType: parsedUA.device.type,
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
        isCurrent: session.id === currentSession?.id,
      };
    })
    // Sort: current session first, then by most recently updated
    .sort((a, b) => {
      if (a.isCurrent) return -1;
      if (b.isCurrent) return 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

  return activeSessions;
}
