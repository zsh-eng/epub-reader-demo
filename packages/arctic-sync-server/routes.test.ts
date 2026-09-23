import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  SYNC_D1_SCHEMA_SQL,
  type SyncD1Database,
  type SyncD1Statement,
} from "@zsh-eng/local-sync/hono";
import {
  articleFileID,
  createArcticRoutes,
  MAX_ARTICLE_FILE_BYTES,
  type ArticleBucket,
} from "./routes";

const databases: Database[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
class Statement implements SyncD1Statement {
  values: (string | number | null)[] = [];
  constructor(
    readonly database: Database,
    readonly sql: string,
  ) {}
  bind(...values: unknown[]) {
    this.values = values as typeof this.values;
    return this;
  }
  async first<T>() {
    return this.database.query(this.sql).get(...this.values) as T | null;
  }
  async all<T>() {
    return {
      results: this.database.query(this.sql).all(...this.values) as T[],
    };
  }
}
function fixture() {
  const sql = new Database(":memory:");
  databases.push(sql);
  sql.exec(SYNC_D1_SCHEMA_SQL);
  const database: SyncD1Database = {
    prepare: (query) => new Statement(sql, query),
    async batch<T>(statements: SyncD1Statement[]) {
      sql.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements)
          results.push(await statement.all<T>());
        sql.exec("COMMIT");
        return results;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const objects = new Map<string, ArrayBuffer>();
  const bucket: ArticleBucket = {
    async put(key, bytes) {
      objects.set(key, bytes);
    },
    async get(key) {
      const bytes = objects.get(key);
      return bytes
        ? {
            body: new Blob([bytes]).stream(),
            size: bytes.byteLength,
            httpEtag: '"etag"',
          }
        : null;
    },
  };
  type Env = { Variables: { account: string } };
  const app = new Hono<Env>().route(
    "/api/arctic",
    createArcticRoutes<Env>({
      requireAuth: async (c, next) => {
        // Tests only. Production identity is supplied by validated Better Auth sessions.
        const account = c.req.header("Test-Account");
        if (!account) return c.json({ error: "Unauthorized" }, 401);
        c.set("account", account);
        await next();
      },
      getIdentity: (c) => ({
        userId: c.get("account"),
        deviceId: c.req.header("X-Device-ID"),
      }),
      getDatabase: () => database,
      getBucket: () => bucket,
    }),
  );
  const request = (path: string, account = "alice", init: RequestInit = {}) =>
    app.request(`/api/arctic${path}`, {
      ...init,
      headers: {
        "Test-Account": account,
        "X-Device-ID": "phone",
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
  return { app, request, objects };
}
const change = {
  key: "articles/a",
  value: "{}",
  schemaVersion: 1,
  isDeleted: false,
  hlc: { wallTimeMs: 1000, counter: 0 },
};

test("sync requires authentication and isolates account records", async () => {
  const { app, request } = fixture();
  expect(
    (
      await app.request(
        "/api/arctic/sync/v2/pull?cursor=0&excludeOwnDevice=false",
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await request("/sync/v2/push", "alice", {
        method: "POST",
        body: JSON.stringify({ changes: [change] }),
      })
    ).status,
  ).toBe(200);
  const own = await (
    await request("/sync/v2/pull?cursor=0&excludeOwnDevice=false")
  ).json();
  expect(own.records).toHaveLength(1);
  const other = await (
    await request("/sync/v2/pull?cursor=0&excludeOwnDevice=false", "bob")
  ).json();
  expect(other.records).toHaveLength(0);
});
test("stale updates cannot resurrect a tombstone", async () => {
  const { request } = fixture();
  const deleted = {
    ...change,
    isDeleted: true,
    hlc: { wallTimeMs: 1001, counter: 0 },
  };
  await request("/sync/v2/push", "alice", {
    method: "POST",
    body: JSON.stringify({ changes: [deleted] }),
  });
  const response = await (
    await request("/sync/v2/push", "alice", {
      method: "POST",
      body: JSON.stringify({ changes: [change] }),
    })
  ).json();
  expect(response.results[0].accepted).toBe(false);
  expect(response.results[0].winner.isDeleted).toBe(true);
});
test("files are content verified and isolated, and HTML cannot execute on API origin", async () => {
  const { request, objects, app } = fixture();
  const bytes = new TextEncoder().encode("<script>untrusted()</script>").buffer;
  const id = await articleFileID(bytes);
  expect((await app.request(`/api/arctic/files/${id}`)).status).toBe(401);
  expect(
    (await request(`/files/${id}`, "alice", { method: "PUT", body: bytes }))
      .status,
  ).toBe(200);
  expect(
    (await request(`/files/${id}`, "alice", { method: "PUT", body: bytes }))
      .status,
  ).toBe(200);
  expect(objects.size).toBe(1);
  expect((await request(`/files/${id}`, "bob")).status).toBe(404);
  const response = await request(`/files/${id}`);
  expect(await response.text()).toBe("<script>untrusted()</script>");
  expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
  expect(response.headers.get("Content-Security-Policy")).toContain("sandbox");
  expect(
    (await request(`/files/${id}`, "alice", { method: "PUT", body: "wrong" }))
      .status,
  ).toBe(400);
});
test("oversized file uploads are bounded", async () => {
  const { request, objects } = fixture();
  const response = await request(`/files/sha256:${"0".repeat(64)}`, "alice", {
    method: "PUT",
    body: new Uint8Array(MAX_ARTICLE_FILE_BYTES + 1),
  });
  expect(response.status).toBe(413);
  expect(objects.size).toBe(0);
});
