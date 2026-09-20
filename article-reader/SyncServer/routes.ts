import { Hono, type Context, type Env, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  createSyncHonoRoutes,
  type SyncD1Database,
} from "@zsh-eng/local-sync/hono";

export const MAX_ARTICLE_FILE_BYTES = 8 * 1024 * 1024;
const fileID = /^sha256:[a-f0-9]{64}$/;

/** A narrow R2 contract also permits isolated tests without a Cloudflare account. */
export interface ArticleBucket {
  put(
    key: string,
    bytes: ArrayBuffer,
    options: { httpMetadata: { contentType: string } },
  ): Promise<unknown>;
  get(
    key: string,
  ): Promise<{
    body: ReadableStream<Uint8Array>;
    size: number;
    httpEtag: string;
  } | null>;
}
export interface ArcticRoutesOptions<E extends Env> {
  requireAuth: MiddlewareHandler<E>;
  getIdentity(c: Context<E>): { userId: string; deviceId: string | undefined };
  /** Must be a separate database from Reader's record stream. */
  getDatabase(c: Context<E>): SyncD1Database;
  getBucket(c: Context<E>): ArticleBucket;
}

export async function articleFileID(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
function objectKey(userID: string, id: string) {
  return `arctic/v1/users/${encodeURIComponent(userID)}/${id}`;
}

/** Mount at /api/arctic after host session middleware. Never accept a client user ID. */
export function createArcticRoutes<E extends Env>(
  options: ArcticRoutesOptions<E>,
) {
  return new Hono<E>()
    .route("/sync/v2", createSyncHonoRoutes(options))
    .put(
      "/files/:id",
      options.requireAuth,
      bodyLimit({
        maxSize: MAX_ARTICLE_FILE_BYTES,
        onError: (c) => c.json({ error: "Article file is too large" }, 413),
      }),
      async (c) => {
        const id = c.req.param("id");
        if (!fileID.test(id)) return c.json({ error: "Invalid file ID" }, 400);
        const bytes = await c.req.arrayBuffer();
        if ((await articleFileID(bytes)) !== id)
          return c.json({ error: "File ID does not match bytes" }, 400);
        // Save bytes before publishing a metadata record that refers to them.
        // Retries are idempotent. The owner comes only from validated authentication.
        await options
          .getBucket(c)
          .put(objectKey(options.getIdentity(c).userId, id), bytes, {
            httpMetadata: { contentType: "application/octet-stream" },
          });
        return c.json({ id, size: bytes.byteLength });
      },
    )
    .get("/files/:id", options.requireAuth, async (c) => {
      const id = c.req.param("id");
      if (!fileID.test(id)) return c.json({ error: "Invalid file ID" }, 400);
      const object = await options
        .getBucket(c)
        .get(objectKey(options.getIdentity(c).userId, id));
      if (!object) return c.json({ error: "File not found" }, 404);
      // Never execute a saved publisher HTML document on the authenticated API origin.
      return new Response(object.body, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": "attachment",
          "Content-Security-Policy": "sandbox; default-src 'none'",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
          "Content-Length": String(object.size),
          ETag: object.httpEtag,
        },
      });
    });
}
