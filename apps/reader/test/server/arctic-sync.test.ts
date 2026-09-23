import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { articleFileID } from "@workbench/arctic-sync-server/routes";
import { createTestUser } from "./helpers";

describe("Arctic native sync host", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  let other: Awaited<ReturnType<typeof createTestUser>>;
  beforeAll(async () => {
    user = await createTestUser(
      "arctic@example.com",
      "testpassword123",
      "Arctic Reader",
    );
    other = await createTestUser(
      "arctic-other@example.com",
      "testpassword123",
      "Other Reader",
    );
  });
  function headers(cookie = user.sessionCookie) {
    return {
      Cookie: cookie,
      "X-Device-ID": "arctic-iphone",
      "Content-Type": "application/json",
    };
  }
  const pullPath = "/sync/v2/pull?cursor=0&excludeOwnDevice=false";
  it("authenticates native email sign-in and rejects a revoked session", async () => {
    const login = await SELF.fetch(
      "https://reader.zsheng.app/api/auth/sign-in/email",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://reader.zsheng.app",
        },
        body: JSON.stringify({ email: user.email, password: user.password }),
      },
    );
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    expect(cookie).toContain("__Secure-better-auth.session_token=");
    const authorized = await SELF.fetch(
      `https://reader.zsheng.app/api/arctic${pullPath}`,
      { headers: headers(cookie) },
    );
    expect(authorized.status).toBe(200);
    const logout = await SELF.fetch(
      "https://reader.zsheng.app/api/auth/sign-out",
      {
        method: "POST",
        headers: { ...headers(cookie), Origin: "https://reader.zsheng.app" },
        body: "{}",
      },
    );
    expect(logout.status).toBe(200);
    expect(
      (
        await SELF.fetch(`https://reader.zsheng.app/api/arctic${pullPath}`, {
          headers: headers(cookie),
        })
      ).status,
    ).toBe(401);
  });
  it("requires authentication and stores Arctic records outside Reader's database", async () => {
    expect(
      (await SELF.fetch(`http://example.com/api/arctic${pullPath}`)).status,
    ).toBe(401);
    const change = {
      key: "article/fixture",
      value: '{"title":"Glacial Longings"}',
      isDeleted: false,
      schemaVersion: 1,
      hlc: { wallTimeMs: 1000, counter: 0 },
    };
    const pushed = await SELF.fetch(
      "http://example.com/api/arctic/sync/v2/push",
      {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ changes: [change] }),
      },
    );
    expect(pushed.status).toBe(200);
    expect(
      await env.ARCTIC_DATABASE.prepare(
        "SELECT value FROM sync_records WHERE user_id = ? AND key = ?",
      )
        .bind(user.userId, change.key)
        .first(),
    ).toEqual({ value: change.value });
    expect(
      await env.DATABASE.prepare(
        "SELECT value FROM sync_records WHERE user_id = ? AND key = ?",
      )
        .bind(user.userId, change.key)
        .first(),
    ).toBeNull();
    const otherPull = await SELF.fetch(
      `http://example.com/api/arctic${pullPath}`,
      { headers: headers(other.sessionCookie) },
    );
    expect(await otherPull.json()).toMatchObject({ records: [] });
    const readerPull = await SELF.fetch(`http://example.com/api${pullPath}`, {
      headers: headers(),
    });
    expect(await readerPull.json()).toMatchObject({ records: [] });
  });
  it("isolates authenticated HTML objects without exposing a public executable document", async () => {
    const bytes = new TextEncoder().encode("<p>“Glacial Longings”</p>").buffer;
    const id = await articleFileID(bytes);
    const url = `http://example.com/api/arctic/files/${id}`;
    const uploaded = await SELF.fetch(url, {
      method: "PUT",
      headers: headers(),
      body: bytes,
    });
    expect(uploaded.status).toBe(200);
    const download = await SELF.fetch(url, { headers: headers() });
    expect(download.status).toBe(200);
    expect(download.headers.get("Content-Type")).toBe(
      "application/octet-stream",
    );
    expect(download.headers.get("Content-Security-Policy")).toContain(
      "sandbox",
    );
    expect(new TextDecoder().decode(await download.arrayBuffer())).toBe(
      "<p>“Glacial Longings”</p>",
    );
    expect(
      (await SELF.fetch(url, { headers: headers(other.sessionCookie) })).status,
    ).toBe(404);
    expect((await SELF.fetch(url)).status).toBe(401);
    expect(
      await env.BOOK_STORAGE.head(`arctic/v1/users/${user.userId}/${id}`),
    ).not.toBeNull();
  });
});
