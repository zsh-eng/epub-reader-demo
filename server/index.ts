import { zValidator } from "@hono/zod-validator";
import { createAuth } from "@server/lib/auth";
import {
  deleteBook,
  fileHashParamSchema,
  getBooks,
  markUploadComplete,
  syncBooks,
  syncBooksBodySchema,
  syncBooksQuerySchema,
  uploadCompleteBodySchema,
} from "@server/lib/book-sync";
import { getDevices } from "@server/lib/devices";
import { extractDevice } from "@server/lib/middleware/extract-device";
import { requireAuth, requireUser } from "@server/lib/middleware/require-auth";
import { getActiveSessions } from "@server/lib/sessions";
import type { Session, User } from "better-auth/types";
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
  extractDevice,
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
  .get("/me", requireUser, (c) => {
    const user = c.get("user")!;
    return c.json({ user });
  })
  .get("/sessions", requireUser, async (c) => {
    const user = c.get("user")!;
    const currentSession = c.get("session")!;
    const activeSessions = await getActiveSessions(c.env, currentSession, user);
    return c.json({ sessions: activeSessions });
  })
  .get("/devices", requireAuth, async (c) => {
    const user = c.get("user")!;
    const currentDeviceId = c.get("deviceId")!;
    const devices = await getDevices(c.env.DATABASE, user.id, currentDeviceId);
    return c.json({ devices });
  })
  // Book sync endpoints
  .get(
    "/sync/books",
    requireUser,
    zValidator("query", syncBooksQuerySchema),
    async (c) => {
      const user = c.get("user")!;
      const { since } = c.req.valid("query");

      const result = await getBooks(c.env.DATABASE, user.id, since);
      return c.json(result);
    },
  )
  .post(
    "/sync/books",
    requireUser,
    zValidator("json", syncBooksBodySchema),
    async (c) => {
      const user = c.get("user")!;
      const { books } = c.req.valid("json");

      const result = await syncBooks(c.env.DATABASE, user.id, books);
      return c.json(result);
    },
  )
  .post(
    "/sync/books/:fileHash/upload-complete",
    requireUser,
    zValidator("param", fileHashParamSchema),
    zValidator("json", uploadCompleteBodySchema),
    async (c) => {
      const user = c.get("user")!;
      const { fileHash } = c.req.valid("param");
      const { type, r2Key } = c.req.valid("json");

      const result = await markUploadComplete(
        c.env.DATABASE,
        user.id,
        fileHash,
        type,
        r2Key,
      );

      if ("error" in result) {
        return c.json({ error: result.error }, result.status as 404);
      }

      return c.json(result);
    },
  )
  .delete(
    "/sync/books/:fileHash",
    requireUser,
    zValidator("param", fileHashParamSchema),
    async (c) => {
      const user = c.get("user")!;
      const { fileHash } = c.req.valid("param");

      const result = await deleteBook(c.env.DATABASE, user.id, fileHash);

      if ("error" in result) {
        return c.json({ error: result.error }, result.status as 404);
      }

      return c.json(result);
    },
  );

export default app;

// Export type for client-side type inference
export type AppType = typeof route;
