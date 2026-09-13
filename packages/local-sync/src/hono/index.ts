import { Hono, type Context, type Env, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { zValidator } from "@hono/zod-validator";
import {
  type SyncPushBody,
  type SyncPullBody,
  MAX_SYNC_FUTURE_CLOCK_SKEW_MS,
  MAX_SYNC_PUSH_BODY_BYTES,
  syncDeviceIdSchema,
  syncPushBodySchema as syncV2PushBodySchema,
  syncPullQuerySchema as syncV2PullQuerySchema,
} from "../protocol.js";
import {
  pushSyncV2,
  readSyncV2Head,
  pullSyncV2,
  type SyncD1Database,
} from "./d1.js";
export {
  SYNC_D1_SCHEMA_SQL,
  type SyncD1Database,
  type SyncD1Statement,
} from "./d1.js";

export interface SyncHonoOptions<E extends Env> {
  requireAuth: MiddlewareHandler<E>;
  /** Use authenticated context, never a user ID supplied in the request body. */
  getIdentity(context: Context<E>): {
    userId: string;
    deviceId: string | undefined;
  };
  getDatabase(context: Context<E>): SyncD1Database;
  now?: () => number;
}

/** Mount at the application's sync prefix. Auth and database ownership stay with the host. */
export function createSyncHonoRoutes<E extends Env>(
  options: SyncHonoOptions<E>,
) {
  return new Hono<E>()
    .post(
      "/push",
      options.requireAuth,
      bodyLimit({
        maxSize: MAX_SYNC_PUSH_BODY_BYTES,
        onError: (c) => c.json({ error: "Request body too large" }, 413),
      }),
      zValidator<typeof syncV2PushBodySchema, "json", E, "/push">(
        "json",
        syncV2PushBodySchema,
      ),
      async (c: Context<E, "/push", { out: { json: SyncPushBody } }>) => {
        const identity = options.getIdentity(c);
        const deviceIdResult = syncDeviceIdSchema.safeParse(identity.deviceId);
        if (!deviceIdResult.success) {
          return c.json({ error: "Invalid device ID" }, 400);
        }

        const { changes } = c.req.valid("json");
        const latestAllowedWallTime =
          (options.now ?? Date.now)() + MAX_SYNC_FUTURE_CLOCK_SKEW_MS;
        if (
          changes.some(
            (change) => change.hlc.wallTimeMs > latestAllowedWallTime,
          )
        ) {
          return c.json(
            { error: "HLC wall time is too far in the future" },
            400,
          );
        }

        return c.json(
          await pushSyncV2(
            options.getDatabase(c),
            identity.userId,
            deviceIdResult.data,
            changes,
          ),
        );
      },
    )
    .get(
      "/pull",
      options.requireAuth,
      zValidator<typeof syncV2PullQuerySchema, "query", E, "/pull">(
        "query",
        syncV2PullQuerySchema,
      ),
      async (c: Context<E, "/pull", { out: { query: SyncPullBody } }>) => {
        c.header("Cache-Control", "no-store");
        const identity = options.getIdentity(c);
        const deviceIdResult = syncDeviceIdSchema.safeParse(identity.deviceId);
        if (!deviceIdResult.success) {
          return c.json({ error: "Invalid device ID" }, 400);
        }

        const body = c.req.valid("query");
        const currentHead = await readSyncV2Head(
          options.getDatabase(c),
          identity.userId,
        );
        const head = body.head ?? currentHead;
        if (body.cursor > currentHead || head > currentHead) {
          return c.json(
            { error: "Cursor or head exceeds the current stream" },
            400,
          );
        }

        return c.json(
          await pullSyncV2(
            options.getDatabase(c),
            identity.userId,
            deviceIdResult.data,
            body,
            head,
          ),
        );
      },
    );
}
