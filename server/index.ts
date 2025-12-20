import * as schema from "@server/db/schema";
import { createAuth } from "@server/lib/auth";
import { deviceMiddleware } from "@server/lib/device-middleware";
import { getActiveSessions } from "@server/lib/sessions";
import type { Session, User } from "better-auth/types";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { cors } from "hono/cors";

// Define your environment bindings type
type Bindings = Env;

const app = new Hono<{
  Bindings: Bindings;
  Variables: {
    user: User | undefined;
    session: Session | undefined;
    deviceId: string | undefined;
  };
}>();

app.use(
  "*",
  async (c, next) => {
    const auth = createAuth(c.env);
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (session) {
      c.set("user", session.user);
      c.set("session", session.session);
    }

    await next();
  },
  deviceMiddleware,
);

// https://www.better-auth.com/docs/integrations/hono#cors
app.use(
  "/api/auth/*", // or replace with "*" to enable cors for all routes
  async (c, next) => {
    const corsMiddlewareHandler = cors({
      origin: c.env.BASE_URL || "http://localhost:5173",
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["POST", "GET", "OPTIONS"],
      exposeHeaders: ["Content-Length"],
      maxAge: 600,
      credentials: true,
    });
    return corsMiddlewareHandler(c, next);
  },
);

app.on(["POST", "GET"], "/api/auth/*", (c) => {
  const auth = createAuth(c.env);
  return auth.handler(c.req.raw);
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const route = app
  .basePath("/api")
  .get("/hello", (c) => {
    return c.json({ message: "Hello from backend!" });
  })
  .get("/me", (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    return c.json({ user });
  })
  .get("/sessions", async (c) => {
    const user = c.get("user");
    const currentSession = c.get("session");

    if (!user || !currentSession) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const activeSessions = await getActiveSessions(c.env, currentSession, user);

    return c.json({ sessions: activeSessions });
  })
  .get("/devices", async (c) => {
    const user = c.get("user");
    const currentDeviceId = c.get("deviceId");

    if (!user || !currentDeviceId) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const db = drizzle(c.env.DATABASE, { schema });

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
      .where(eq(schema.userDevice.userId, user.id))
      .orderBy(desc(schema.userDevice.lastActiveAt));

    const devicesWithCurrentFlag = devices.map((device) => ({
      ...device,
      isCurrent: device.clientId === currentDeviceId,
      lastActiveAt: device.lastActiveAt?.toISOString(),
      createdAt: device.createdAt.toISOString(),
    }));

    return c.json({ devices: devicesWithCurrentFlag });
  });

export default app;

// Export type for client-side type inference
export type AppType = typeof route;
