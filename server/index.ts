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
  )
  .get("/files/:userId/*", requireUser, async (c) => {
    const user = c.get("user")!;
    const requestedUserId = c.req.param("userId");

    // Extract the file path from the full request path
    const fullPath = c.req.path;
    const prefix = `/api/files/${requestedUserId}/`;

    if (!fullPath.startsWith(prefix)) {
      return c.json({ error: "Invalid path" }, 400);
    }

    const filePath = fullPath.slice(prefix.length);

    // Security: Only allow users to access their own files
    if (user.id !== requestedUserId) {
      return c.json({ error: "Forbidden" }, 403);
    }

    if (!filePath) {
      return c.json({ error: "File path is required" }, 400);
    }

    // Construct the full R2 key (e.g., "epubs/userId/hash.epub" or "covers/userId/hash")
    const r2Key = filePath;

    try {
      const object = await c.env.BOOK_STORAGE.get(r2Key);

      if (!object) {
        return c.json({ error: "File not found" }, 404);
      }

      // Determine content type based on file extension
      let contentType = "application/octet-stream";
      if (r2Key.endsWith(".epub")) {
        contentType = "application/epub+zip";
      } else if (r2Key.match(/\.(jpg|jpeg)$/i)) {
        contentType = "image/jpeg";
      } else if (r2Key.endsWith(".png")) {
        contentType = "image/png";
      } else if (r2Key.endsWith(".webp")) {
        contentType = "image/webp";
      }

      // Set cache control headers
      // Cache-Control: private ensures CDN/proxies don't cache user-specific content
      // max-age=31536000 (1 year) since files are content-addressed by hash
      const headers = new Headers({
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Length": object.size.toString(),
      });

      // Add ETag if available
      if (object.httpEtag) {
        headers.set("ETag", object.httpEtag);
      }

      return new Response(object.body, {
        headers,
      });
    } catch (error) {
      console.error("Error fetching file from R2:", error);
      return c.json({ error: "Failed to retrieve file" }, 500);
    }
  });

export default app;

// Export type for client-side type inference
export type AppType = typeof route;
