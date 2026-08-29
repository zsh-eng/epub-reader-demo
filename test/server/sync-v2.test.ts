import {
  MAX_SYNC_FUTURE_CLOCK_SKEW_MS,
  MAX_SYNC_PUSH_BODY_BYTES,
  type SyncPullBody,
  type SyncPullResponse,
  type SyncPushChange,
  type SyncPushResponse,
  encodeSyncKey,
  encodeSyncValue,
} from "@/lib/sync-v2/protocol";
import { env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestUser } from "./helpers";

describe("sync v2 API", () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>;
  let otherUser: Awaited<ReturnType<typeof createTestUser>>;

  beforeAll(async () => {
    testUser = await createTestUser(
      "sync-v2@example.com",
      "testpassword123",
      "Sync V2 Test User",
    );
    otherUser = await createTestUser(
      "sync-v2-other@example.com",
      "testpassword123",
      "Other Sync V2 Test User",
    );
  });

  beforeEach(async () => {
    await env.DATABASE.prepare("DELETE FROM sync_records WHERE user_id = ?")
      .bind(testUser.userId)
      .run();
    await env.DATABASE.prepare("DELETE FROM sync_records WHERE user_id = ?")
      .bind(otherUser.userId)
      .run();
  });

  it("requires an authenticated user and valid device ID", async () => {
    const change = syncChange("auth", 100);
    const unauthenticated = await SELF.fetch(
      "http://example.com/api/sync/v2/push",
      syncRequest("device-a", { changes: [change] }, false),
    );
    const missingDevice = await SELF.fetch(
      "http://example.com/api/sync/v2/push",
      syncRequest(undefined, { changes: [change] }),
    );
    const invalidDevice = await SELF.fetch(
      "http://example.com/api/sync/v2/push",
      syncRequest("invalid device", { changes: [change] }),
    );

    expect(unauthenticated.status).toBe(401);
    expect(missingDevice.status).toBe(401);
    expect(invalidDevice.status).toBe(400);
  });

  it("stores compacted winners and retains soft-deleted values", async () => {
    const deletedValue = encodeSyncValue({
      id: "deleted-book",
      title: "Restore me",
      isDeleted: true,
    });
    const response = await push("device-a", [
      syncChange("active-book", 100),
      syncChange("deleted-book", 101, {
        value: deletedValue,
        isDeleted: true,
      }),
    ]);

    expect(response.status).toBe(200);
    const body = (await response.json()) as SyncPushResponse;
    expect(body.results.map((result) => result.accepted)).toEqual([true, true]);
    expect(body.results[1]?.winner).toMatchObject({
      value: deletedValue,
      isDeleted: true,
      deviceId: "device-a",
    });
    expect(
      new Set(body.results.map((result) => result.winner.serverSeq)).size,
    ).toBe(2);

    const stored = await env.DATABASE.prepare(
      "SELECT value, is_deleted FROM sync_records WHERE user_id = ? AND key = ?",
    )
      .bind(testUser.userId, encodeSyncKey("books", "deleted-book"))
      .first<{ value: string; is_deleted: number }>();
    expect(stored).toEqual({ value: deletedValue, is_deleted: 1 });
  });

  it("returns the current winner for stale writes and idempotent retries", async () => {
    const initialChange = syncChange("lww-book", 200);
    const initialResponse = await push("device-a", [initialChange]);
    const initial = (await initialResponse.json()) as SyncPushResponse;
    const initialWinner = initial.results[0]!.winner;

    const staleResponse = await push("device-z", [
      syncChange("lww-book", 199, {
        value: encodeSyncValue({ id: "lww-book", title: "Stale" }),
      }),
    ]);
    const stale = (await staleResponse.json()) as SyncPushResponse;
    expect(stale.results[0]).toEqual({
      accepted: false,
      winner: initialWinner,
    });

    const retryResponse = await push("device-a", [initialChange]);
    const retry = (await retryResponse.json()) as SyncPushResponse;
    expect(retry.results[0]).toEqual({
      accepted: false,
      winner: initialWinner,
    });

    const tieBreakResponse = await push("device-z", [
      syncChange("lww-book", 200, {
        value: encodeSyncValue({ id: "lww-book", title: "Tie-break winner" }),
      }),
    ]);
    const tieBreak = (await tieBreakResponse.json()) as SyncPushResponse;
    expect(tieBreak.results[0]).toMatchObject({
      accepted: true,
      winner: {
        deviceId: "device-z",
        value: encodeSyncValue({
          id: "lww-book",
          title: "Tie-break winner",
        }),
      },
    });
    expect(tieBreak.results[0]!.winner.serverSeq).toBeGreaterThan(
      initialWinner.serverSeq + 1,
    );
  });

  it("accepts a 500-change batch", async () => {
    const changes = Array.from({ length: 500 }, (_, index) =>
      syncChange(`batch-${index}`, 1_000 + index),
    );
    const response = await push("device-a", changes);

    expect(response.status).toBe(200);
    const body = (await response.json()) as SyncPushResponse;
    expect(body.results).toHaveLength(500);
    expect(body.results.every((result) => result.accepted)).toBe(true);
    expect(
      new Set(body.results.map((result) => result.winner.serverSeq)).size,
    ).toBe(500);
  });

  it("rejects invalid clocks, duplicate keys, and oversized payloads before writing", async () => {
    const duplicate = syncChange("duplicate", 100);
    const future = syncChange(
      "future",
      Date.now() + MAX_SYNC_FUTURE_CLOCK_SKEW_MS + 60_000,
    );
    const oversizedValue = syncChange("large-value", 100, {
      value: "x".repeat(64 * 1_024 + 1),
    });

    const duplicateResponse = await push("device-a", [duplicate, duplicate]);
    const futureResponse = await push("device-a", [future]);
    const valueResponse = await push("device-a", [oversizedValue]);

    expect(duplicateResponse.status).toBe(400);
    expect(futureResponse.status).toBe(400);
    expect(valueResponse.status).toBe(400);

    const count = await env.DATABASE.prepare(
      "SELECT COUNT(*) AS count FROM sync_records WHERE user_id = ?",
    )
      .bind(testUser.userId)
      .first<{ count: number }>();
    expect(count?.count).toBe(0);
  });

  it("rejects request bodies over one MiB", async () => {
    const changes = Array.from({ length: 17 }, (_, index) =>
      syncChange(`large-batch-${index}`, 100 + index, {
        value: "x".repeat(64 * 1_024),
      }),
    );
    const body = JSON.stringify({ changes });
    expect(new TextEncoder().encode(body).byteLength).toBeGreaterThan(
      MAX_SYNC_PUSH_BODY_BYTES,
    );

    const response = await push("device-a", changes);

    expect(response.status).toBe(413);
  });

  it("keeps a fixed pull head while bootstrap pages", async () => {
    await push("device-a", [
      syncChange("bootstrap-1", 100),
      syncChange("bootstrap-2", 101),
    ]);

    const firstResponse = await pull("device-a", {
      cursor: 0,
      limit: 1,
      excludeOwnDevice: false,
    });
    const first = (await firstResponse.json()) as SyncPullResponse;
    expect(first.records.map((record) => record.key)).toEqual([
      encodeSyncKey("books", "bootstrap-1"),
    ]);
    expect(first.hasMore).toBe(true);
    expect(first.cursor).toBe(first.records[0]!.serverSeq);

    await push("device-b", [syncChange("after-head", 102)]);

    const secondResponse = await pull("device-a", {
      cursor: first.cursor,
      head: first.head,
      limit: 1,
      excludeOwnDevice: false,
    });
    const second = (await secondResponse.json()) as SyncPullResponse;
    expect(second.records.map((record) => record.key)).toEqual([
      encodeSyncKey("books", "bootstrap-2"),
    ]);
    expect(second).toMatchObject({
      cursor: first.head,
      head: first.head,
      hasMore: false,
    });

    const incrementalResponse = await pull("device-a", {
      cursor: second.cursor,
      excludeOwnDevice: true,
    });
    const incremental = (await incrementalResponse.json()) as SyncPullResponse;
    expect(incremental.records.map((record) => record.key)).toEqual([
      encodeSyncKey("books", "after-head"),
    ]);
  });

  it("advances across omitted own-device sequences", async () => {
    const pushResponse = await push("device-a", [
      syncChange("own-device", 100),
    ]);
    const pushed = (await pushResponse.json()) as SyncPushResponse;
    const ownSequence = pushed.results[0]!.winner.serverSeq;

    const pullResponse = await pull("device-a", {
      cursor: 0,
      excludeOwnDevice: true,
    });
    const body = (await pullResponse.json()) as SyncPullResponse;

    expect(body).toEqual({
      records: [],
      cursor: ownSequence,
      head: ownSequence,
      hasMore: false,
    });
  });

  it("isolates identical logical keys by authenticated user", async () => {
    const key = encodeSyncKey("books", "shared-key");
    const firstValue = encodeSyncValue({ id: "shared-key", owner: "first" });
    const secondValue = encodeSyncValue({ id: "shared-key", owner: "second" });

    await push("device-a", [
      syncChange("shared-key", 100, { key, value: firstValue }),
    ]);
    await push(
      "device-a",
      [syncChange("shared-key", 100, { key, value: secondValue })],
      otherUser,
    );

    const firstPull = (await (
      await pull("device-a", { cursor: 0, excludeOwnDevice: false })
    ).json()) as SyncPullResponse;
    const secondPull = (await (
      await pull("device-a", { cursor: 0, excludeOwnDevice: false }, otherUser)
    ).json()) as SyncPullResponse;

    expect(firstPull.records).toHaveLength(1);
    expect(firstPull.records[0]?.value).toBe(firstValue);
    expect(secondPull.records).toHaveLength(1);
    expect(secondPull.records[0]?.value).toBe(secondValue);
  });

  async function push(
    deviceId: string,
    changes: readonly SyncPushChange[],
    user = testUser,
  ): Promise<Response> {
    return SELF.fetch(
      "http://example.com/api/sync/v2/push",
      syncRequest(deviceId, { changes }, true, user.sessionCookie),
    );
  }

  async function pull(
    deviceId: string,
    body: SyncPullBody,
    user = testUser,
  ): Promise<Response> {
    const query = new URLSearchParams({
      cursor: String(body.cursor),
      excludeOwnDevice: String(body.excludeOwnDevice),
      ...(body.head === undefined ? {} : { head: String(body.head) }),
      ...(body.limit === undefined ? {} : { limit: String(body.limit) }),
    });

    return SELF.fetch(`http://example.com/api/sync/v2/pull?${query}`, {
      headers: {
        "X-Device-ID": deviceId,
        Cookie: user.sessionCookie,
      },
    });
  }

  function syncRequest(
    deviceId: string | undefined,
    body: unknown,
    authenticated = true,
    sessionCookie = testUser.sessionCookie,
  ): RequestInit {
    return {
      method: "POST",
      headers: {
        ...(deviceId === undefined ? {} : { "X-Device-ID": deviceId }),
        ...(authenticated ? { Cookie: sessionCookie } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    };
  }
});

function syncChange(
  recordId: string,
  wallTimeMs: number,
  overrides: Partial<SyncPushChange> = {},
): SyncPushChange {
  return {
    key: encodeSyncKey("books", recordId),
    value: encodeSyncValue({ id: recordId, title: recordId }),
    isDeleted: false,
    schemaVersion: 1,
    hlc: { wallTimeMs, counter: 0 },
    ...overrides,
  };
}
