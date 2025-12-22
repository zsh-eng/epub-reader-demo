import { zValidator } from "@hono/zod-validator";
import { createAuth } from "@server/lib/auth";
import { getDevices } from "@server/lib/devices";
import { fileTypeSchema, lookupFileR2Key } from "@server/lib/file-lookup";
import { uploadFile } from "@server/lib/file-upload";
import { extractDevice } from "@server/lib/middleware/extract-device";
import { requireAuth, requireUser } from "@server/lib/middleware/require-auth";
import { getActiveSessions } from "@server/lib/sessions";
import {
  getCurrentServerTimestamp,
  pullSyncData,
  pushSyncData,
  syncPullQuerySchema,
  syncPushBodySchema,
} from "@server/lib/sync";
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
  // Content-addressed file endpoint: /api/files/{fileType}/{contentHash}
  // The server looks up the R2 key from the database based on auth + fileType + contentHash
  .get("/files/:fileType/:contentHash", requireUser, async (c) => {
    const user = c.get("user")!;
    const fileTypeParam = c.req.param("fileType");
    const contentHash = c.req.param("contentHash");

    // Validate file type
    const fileTypeResult = fileTypeSchema.safeParse(fileTypeParam);
    if (!fileTypeResult.success) {
      return c.json({ error: "Invalid file type" }, 400);
    }
    const fileType = fileTypeResult.data;

    if (!contentHash) {
      return c.json({ error: "Content hash is required" }, 400);
    }

    try {
      // Look up R2 key from database
      const lookupResult = await lookupFileR2Key(
        c.env.DATABASE,
        user.id,
        fileType,
        contentHash,
      );

      if (!lookupResult) {
        return c.json({ error: "File not found" }, 404);
      }

      // Fetch from R2
      const object = await c.env.BOOK_STORAGE.get(lookupResult.r2Key);

      if (!object) {
        console.error(
          `R2 key exists in DB but not in R2: ${lookupResult.r2Key}`,
        );
        return c.json({ error: "File not found in storage" }, 404);
      }

      // Set cache control headers
      // Cache-Control: private ensures CDN/proxies don't cache user-specific content
      // max-age=31536000 (1 year) since files are content-addressed by hash
      const headers = new Headers({
        "Content-Type": lookupResult.mimeType,
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
  })
  // File upload endpoint
  .post("/files/upload", requireUser, async (c) => {
    const user = c.get("user")!;

    try {
      const body = await c.req.parseBody();

      // Validate that file exists
      const file = body["file"];
      if (!file || typeof file === "string") {
        return c.json(
          { error: "No file provided or invalid file format" },
          400,
        );
      }

      // Validate fileType
      const fileType = body["fileType"];
      if (!fileType || typeof fileType !== "string" || fileType.trim() === "") {
        return c.json({ error: "File type is required" }, 400);
      }

      const fileTypeResult = fileTypeSchema.safeParse(fileType);
      if (!fileTypeResult.success) {
        return c.json({ error: "Invalid file type" }, 400);
      }

      // Upload the file
      const result = await uploadFile(
        c.env.DATABASE,
        c.env.BOOK_STORAGE,
        user.id,
        file,
        fileTypeResult.data,
      );

      return c.json({
        success: true,
        contentHash: result.contentHash,
        fileName: result.fileName,
        fileSize: result.fileSize,
        mimeType: result.mimeType,
        alreadyExists: result.alreadyExists,
      });
    } catch (error) {
      console.error("Error uploading file:", error);
      return c.json({ error: "Failed to upload file" }, 500);
    }
  })
  // Generic HLC-based sync endpoints
  .get(
    "/sync/:table",
    requireUser,
    zValidator("query", syncPullQuerySchema),
    async (c) => {
      const user = c.get("user")!;
      const deviceId = c.get("deviceId")!;
      const table = c.req.param("table");
      const { since, entityId, limit } = c.req.valid("query");

      const result = await pullSyncData(
        c.env.DATABASE,
        user.id,
        deviceId,
        table,
        since,
        entityId,
        limit,
      );
      return c.json(result);
    },
  )
  .post(
    "/sync/:table",
    requireUser,
    zValidator("json", syncPushBodySchema),
    async (c) => {
      const user = c.get("user")!;
      const deviceId = c.get("deviceId")!;
      const table = c.req.param("table");
      const { items } = c.req.valid("json");

      const result = await pushSyncData(
        c.env.DATABASE,
        user.id,
        deviceId,
        table,
        items,
      );
      return c.json(result);
    },
  )
  .get("/sync-timestamp", requireUser, (c) => {
    return c.json({ serverTimestamp: getCurrentServerTimestamp() });
  });

export default app;

// Export type for client-side type inference
export type AppType = typeof route;
