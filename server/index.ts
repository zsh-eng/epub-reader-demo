import { zValidator } from "@hono/zod-validator";
import {
  DEFAULT_SYNC_PULL_LIMIT,
  MAX_SYNC_FUTURE_CLOCK_SKEW_MS,
  MAX_SYNC_PUSH_BODY_BYTES,
  type SyncPullBody,
  type SyncPullResponse,
  type SyncPushChange,
  type SyncPushResponse,
  type SyncRecord,
  syncDeviceIdSchema,
  syncPullQuerySchema as syncV2PullQuerySchema,
  syncPushBodySchema as syncV2PushBodySchema,
} from "@/lib/sync-v2/protocol";
import { createAuth } from "@server/lib/auth";
import { getDevices } from "@server/lib/devices";
import { fileTypeSchema, lookupFileR2Key } from "@server/lib/file-lookup";
import { uploadFile } from "@server/lib/file-upload";
import { extractDevice } from "@server/lib/middleware/extract-device";
import { requireAuth, requireUser } from "@server/lib/middleware/require-auth";
import { getActiveSessions } from "@server/lib/sessions";
import type { Session, User } from "better-auth/types";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";

// Define your environment bindings type
type Bindings = Env;

/**
 * One JSON bind avoids D1's parameter limit. A winning conflict copies the
 * attempted insert's fresh AUTOINCREMENT value into the compacted row.
 */
const APPLY_SYNC_V2_BATCH_SQL = `
  INSERT INTO sync_records (
    user_id,
    key,
    value,
    schema_version,
    hlc_wall_time_ms,
    hlc_counter,
    device_id,
    is_deleted
  )
  SELECT
    ?,
    json_extract(candidate.value, '$.key'),
    json_extract(candidate.value, '$.value'),
    json_extract(candidate.value, '$.schemaVersion'),
    json_extract(candidate.value, '$.hlc.wallTimeMs'),
    json_extract(candidate.value, '$.hlc.counter'),
    ?,
    json_extract(candidate.value, '$.isDeleted')
  FROM json_each(?) AS candidate
  WHERE true
  ON CONFLICT (user_id, key) DO UPDATE SET
    server_seq = excluded.server_seq,
    value = excluded.value,
    schema_version = excluded.schema_version,
    hlc_wall_time_ms = excluded.hlc_wall_time_ms,
    hlc_counter = excluded.hlc_counter,
    device_id = excluded.device_id,
    is_deleted = excluded.is_deleted
  WHERE
    excluded.hlc_wall_time_ms > sync_records.hlc_wall_time_ms
    OR (
      excluded.hlc_wall_time_ms = sync_records.hlc_wall_time_ms
      AND excluded.hlc_counter > sync_records.hlc_counter
    )
    OR (
      excluded.hlc_wall_time_ms = sync_records.hlc_wall_time_ms
      AND excluded.hlc_counter = sync_records.hlc_counter
      AND excluded.device_id > sync_records.device_id
    )
  RETURNING *
`;

const READ_SYNC_V2_BATCH_WINNERS_SQL = `
  WITH requested(key) AS (
    SELECT json_extract(candidate.value, '$.key')
    FROM json_each(?) AS candidate
  )
  SELECT stored.*
  FROM requested
  CROSS JOIN sync_records AS stored
    INDEXED BY sync_records_user_key_unique
  WHERE stored.user_id = ?
    AND stored.key = requested.key
`;

const READ_SYNC_V2_HEAD_SQL = `
  SELECT COALESCE(MAX(server_seq), 0) AS head
  FROM sync_records
  WHERE user_id = ?
`;

const PULL_SYNC_V2_PAGE_SQL = `
  SELECT *
  FROM sync_records INDEXED BY sync_records_user_seq_idx
  WHERE user_id = ?
    AND server_seq > ?
    AND server_seq <= ?
    AND (? = 0 OR device_id <> ?)
  ORDER BY server_seq
  LIMIT ?
`;

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
  .post(
    "/sync/v2/push",
    requireAuth,
    bodyLimit({
      maxSize: MAX_SYNC_PUSH_BODY_BYTES,
      onError: (c) => c.json({ error: "Request body too large" }, 413),
    }),
    zValidator("json", syncV2PushBodySchema),
    async (c) => {
      const user = c.get("user")!;
      const deviceIdResult = syncDeviceIdSchema.safeParse(c.get("deviceId"));
      if (!deviceIdResult.success) {
        return c.json({ error: "Invalid device ID" }, 400);
      }

      const { changes } = c.req.valid("json");
      const latestAllowedWallTime = Date.now() + MAX_SYNC_FUTURE_CLOCK_SKEW_MS;
      if (
        changes.some((change) => change.hlc.wallTimeMs > latestAllowedWallTime)
      ) {
        return c.json({ error: "HLC wall time is too far in the future" }, 400);
      }

      return c.json(
        await pushSyncV2(c.env.DATABASE, user.id, deviceIdResult.data, changes),
      );
    },
  )
  .get(
    "/sync/v2/pull",
    requireAuth,
    zValidator("query", syncV2PullQuerySchema),
    async (c) => {
      c.header("Cache-Control", "no-store");
      const user = c.get("user")!;
      const deviceIdResult = syncDeviceIdSchema.safeParse(c.get("deviceId"));
      if (!deviceIdResult.success) {
        return c.json({ error: "Invalid device ID" }, 400);
      }

      const body = c.req.valid("query");
      const currentHead = await readSyncV2Head(c.env.DATABASE, user.id);
      const head = body.head ?? currentHead;
      if (body.cursor > currentHead || head > currentHead) {
        return c.json(
          { error: "Cursor or head exceeds the current stream" },
          400,
        );
      }

      return c.json(
        await pullSyncV2(
          c.env.DATABASE,
          user.id,
          deviceIdResult.data,
          body,
          head,
        ),
      );
    },
  );

export default app;

// Export type for client-side type inference
export type AppType = typeof route;

interface StoredSyncV2Record {
  readonly server_seq: number;
  readonly user_id: string;
  readonly key: string;
  readonly value: string;
  readonly schema_version: number;
  readonly hlc_wall_time_ms: number;
  readonly hlc_counter: number;
  readonly device_id: string;
  readonly is_deleted: number;
}

async function pushSyncV2(
  database: D1Database,
  userId: string,
  deviceId: string,
  changes: readonly SyncPushChange[],
): Promise<SyncPushResponse> {
  if (changes.length === 0) {
    return { results: [] };
  }

  const encodedChanges = JSON.stringify(changes);
  const [acceptedResult, winnersResult] =
    await database.batch<StoredSyncV2Record>([
      database
        .prepare(APPLY_SYNC_V2_BATCH_SQL)
        .bind(userId, deviceId, encodedChanges),
      database
        .prepare(READ_SYNC_V2_BATCH_WINNERS_SQL)
        .bind(encodedChanges, userId),
    ]);

  if (acceptedResult === undefined || winnersResult === undefined) {
    throw new Error("D1 returned an incomplete sync push result");
  }

  const acceptedKeys = new Set(
    acceptedResult.results.map((record) => record.key),
  );
  const winnersByKey = new Map(
    winnersResult.results.map((record) => [
      record.key,
      decodeStoredSyncV2Record(record),
    ]),
  );

  return {
    results: changes.map((change) => {
      const winner = winnersByKey.get(change.key);
      if (winner === undefined) {
        throw new Error(
          `D1 did not return a winner for sync key ${change.key}`,
        );
      }

      return {
        accepted: acceptedKeys.has(change.key),
        winner,
      };
    }),
  };
}

async function readSyncV2Head(
  database: D1Database,
  userId: string,
): Promise<number> {
  const result = await database
    .prepare(READ_SYNC_V2_HEAD_SQL)
    .bind(userId)
    .first<{ head: number }>();
  return result?.head ?? 0;
}

async function pullSyncV2(
  database: D1Database,
  userId: string,
  deviceId: string,
  body: SyncPullBody,
  head: number,
): Promise<SyncPullResponse> {
  const limit = body.limit ?? DEFAULT_SYNC_PULL_LIMIT;
  const result = await database
    .prepare(PULL_SYNC_V2_PAGE_SQL)
    .bind(
      userId,
      body.cursor,
      head,
      body.excludeOwnDevice ? 1 : 0,
      deviceId,
      limit + 1,
    )
    .all<StoredSyncV2Record>();
  const hasMore = result.results.length > limit;
  const records = result.results.slice(0, limit).map(decodeStoredSyncV2Record);
  const lastRecord = records.at(-1);

  return {
    records,
    cursor: hasMore ? lastRecord!.serverSeq : head,
    head,
    hasMore,
  };
}

function decodeStoredSyncV2Record(record: StoredSyncV2Record): SyncRecord {
  return {
    key: record.key,
    value: record.value,
    isDeleted: record.is_deleted !== 0,
    schemaVersion: record.schema_version,
    hlc: {
      wallTimeMs: record.hlc_wall_time_ms,
      counter: record.hlc_counter,
    },
    deviceId: record.device_id,
    serverSeq: record.server_seq,
  };
}
