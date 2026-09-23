import { fileStorage } from "@server/db/schema";
import { computeFileId, createR2Key, type FileId } from "@server/lib/files";
import { env, SELF } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestUser } from "./helpers";

function toArrayBuffer(content: Uint8Array): ArrayBuffer {
  return content.buffer.slice(
    content.byteOffset,
    content.byteOffset + content.byteLength,
  ) as ArrayBuffer;
}

async function requestFilePut(
  sessionCookie: string,
  content: Uint8Array,
  mediaType = "application/octet-stream",
  requestedFileId?: FileId,
) {
  const fileId =
    requestedFileId ?? (await computeFileId(toArrayBuffer(content)));
  const response = await SELF.fetch(`http://example.com/api/files/${fileId}`, {
    method: "PUT",
    headers: {
      Cookie: sessionCookie,
      "Content-Type": mediaType,
    },
    body: content,
  });

  return { fileId, response };
}

describe("generic files API", () => {
  let firstUser: Awaited<ReturnType<typeof createTestUser>>;
  let secondUser: Awaited<ReturnType<typeof createTestUser>>;

  beforeAll(async () => {
    firstUser = await createTestUser(
      "files-first@example.com",
      "testpassword123",
      "First Files User",
    );
    secondUser = await createTestUser(
      "files-second@example.com",
      "testpassword456",
      "Second Files User",
    );
  });

  it("uploads and downloads opaque file bytes", async () => {
    const content = new TextEncoder().encode("generic-file-round-trip");
    const { fileId, response } = await requestFilePut(
      firstUser.sessionCookie,
      content,
      "application/epub+zip",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: fileId,
      fileSize: content.byteLength,
      mediaType: "application/epub+zip",
      createdAt: expect.any(Number),
      alreadyExists: false,
    });

    const db = drizzle(env.DATABASE);
    const storedFile = await db
      .select()
      .from(fileStorage)
      .where(
        and(
          eq(fileStorage.userId, firstUser.userId),
          eq(fileStorage.id, fileId),
        ),
      )
      .get();

    expect(storedFile).toMatchObject({
      id: fileId,
      userId: firstUser.userId,
      r2Key: createR2Key(firstUser.userId, fileId),
      fileSize: content.byteLength,
      mediaType: "application/epub+zip",
      deletedAt: null,
    });

    const downloadResponse = await SELF.fetch(
      `http://example.com/api/files/${fileId}`,
      { headers: { Cookie: firstUser.sessionCookie } },
    );

    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.headers.get("content-type")).toBe(
      "application/epub+zip",
    );
    expect(downloadResponse.headers.get("cache-control")).toBe(
      "private, max-age=31536000, immutable",
    );
    expect(downloadResponse.headers.get("content-length")).toBe(
      content.byteLength.toString(),
    );
    expect(downloadResponse.headers.get("etag")).toBeTruthy();
    expect(new Uint8Array(await downloadResponse.arrayBuffer())).toEqual(
      content,
    );
  });

  it("rejects invalid IDs and content that does not match its ID", async () => {
    const invalidIdResponse = await SELF.fetch(
      "http://example.com/api/files/not-a-file-id",
      {
        method: "PUT",
        headers: { Cookie: firstUser.sessionCookie },
        body: new Uint8Array([1]),
      },
    );
    expect(invalidIdResponse.status).toBe(400);
    expect(await invalidIdResponse.json()).toEqual({
      error: "Invalid file ID",
    });

    const requestedFileId = await computeFileId(
      toArrayBuffer(new TextEncoder().encode("different-content")),
    );
    const { response } = await requestFilePut(
      firstUser.sessionCookie,
      new TextEncoder().encode("actual-content"),
      "text/plain",
      requestedFileId,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "File ID does not match content",
    });

    const r2Object = await env.BOOK_STORAGE.get(
      createR2Key(firstUser.userId, requestedFileId),
    );
    expect(r2Object).toBeNull();
  });

  it("makes repeated uploads idempotent for one user", async () => {
    const content = new TextEncoder().encode("idempotent-file");
    const firstPut = await requestFilePut(
      firstUser.sessionCookie,
      content,
      "text/plain",
    );
    const secondPut = await requestFilePut(
      firstUser.sessionCookie,
      content,
      "text/plain",
    );

    expect(firstPut.response.status).toBe(200);
    expect(secondPut.response.status).toBe(200);
    expect(await secondPut.response.json()).toMatchObject({
      id: firstPut.fileId,
      alreadyExists: true,
    });

    const db = drizzle(env.DATABASE);
    const rows = await db
      .select()
      .from(fileStorage)
      .where(
        and(
          eq(fileStorage.userId, firstUser.userId),
          eq(fileStorage.id, firstPut.fileId),
        ),
      )
      .all();
    expect(rows).toHaveLength(1);
  });

  it("keeps identical files isolated between users", async () => {
    const content = new TextEncoder().encode("shared-file-content");
    const firstPut = await requestFilePut(firstUser.sessionCookie, content);
    const secondPut = await requestFilePut(secondUser.sessionCookie, content);

    expect(firstPut.fileId).toBe(secondPut.fileId);
    expect(await secondPut.response.json()).toMatchObject({
      id: firstPut.fileId,
      alreadyExists: false,
    });

    const db = drizzle(env.DATABASE);
    const rows = await db
      .select()
      .from(fileStorage)
      .where(eq(fileStorage.id, firstPut.fileId))
      .all();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.r2Key))).toEqual(
      new Set([
        createR2Key(firstUser.userId, firstPut.fileId),
        createR2Key(secondUser.userId, firstPut.fileId),
      ]),
    );
  });

  it("lists only the authenticated user's active files", async () => {
    const visibleContent = new TextEncoder().encode("visible-inventory-file");
    const deletedContent = new TextEncoder().encode("deleted-inventory-file");
    const otherContent = new TextEncoder().encode("other-user-file");
    const visiblePut = await requestFilePut(
      firstUser.sessionCookie,
      visibleContent,
      "text/plain",
    );
    const deletedPut = await requestFilePut(
      firstUser.sessionCookie,
      deletedContent,
      "text/plain",
    );
    await requestFilePut(secondUser.sessionCookie, otherContent, "text/plain");

    const deleteResponse = await SELF.fetch(
      `http://example.com/api/files/${deletedPut.fileId}`,
      {
        method: "DELETE",
        headers: { Cookie: firstUser.sessionCookie },
      },
    );
    expect(deleteResponse.status).toBe(204);

    const listResponse = await SELF.fetch("http://example.com/api/files", {
      headers: { Cookie: firstUser.sessionCookie },
    });
    expect(listResponse.status).toBe(200);

    const data = await listResponse.json<{
      files: Array<{ id: FileId; r2Key?: string }>;
    }>();
    expect(data.files.map((file) => file.id)).toContain(visiblePut.fileId);
    expect(data.files.map((file) => file.id)).not.toContain(deletedPut.fileId);
    expect(data.files.every((file) => file.r2Key === undefined)).toBe(true);
  });

  it("deletes remote bytes and can revive the same catalog row", async () => {
    const content = new TextEncoder().encode("delete-and-revive");
    const { fileId } = await requestFilePut(
      firstUser.sessionCookie,
      content,
      "text/plain",
    );
    const r2Key = createR2Key(firstUser.userId, fileId);

    const deleteResponse = await SELF.fetch(
      `http://example.com/api/files/${fileId}`,
      {
        method: "DELETE",
        headers: { Cookie: firstUser.sessionCookie },
      },
    );
    expect(deleteResponse.status).toBe(204);
    expect(await env.BOOK_STORAGE.get(r2Key)).toBeNull();

    const missingResponse = await SELF.fetch(
      `http://example.com/api/files/${fileId}`,
      { headers: { Cookie: firstUser.sessionCookie } },
    );
    expect(missingResponse.status).toBe(404);

    const revivedPut = await requestFilePut(
      firstUser.sessionCookie,
      content,
      "text/plain",
    );
    expect(await revivedPut.response.json()).toMatchObject({
      id: fileId,
      alreadyExists: false,
    });

    const db = drizzle(env.DATABASE);
    const rows = await db
      .select()
      .from(fileStorage)
      .where(
        and(
          eq(fileStorage.userId, firstUser.userId),
          eq(fileStorage.id, fileId),
        ),
      )
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deletedAt).toBeNull();
    expect(await env.BOOK_STORAGE.get(r2Key)).not.toBeNull();
  });

  it("does not expose another user's file through get or delete", async () => {
    const content = new TextEncoder().encode("private-user-file");
    const { fileId } = await requestFilePut(firstUser.sessionCookie, content);

    const getResponse = await SELF.fetch(
      `http://example.com/api/files/${fileId}`,
      { headers: { Cookie: secondUser.sessionCookie } },
    );
    expect(getResponse.status).toBe(404);

    const deleteResponse = await SELF.fetch(
      `http://example.com/api/files/${fileId}`,
      {
        method: "DELETE",
        headers: { Cookie: secondUser.sessionCookie },
      },
    );
    expect(deleteResponse.status).toBe(404);

    const ownerResponse = await SELF.fetch(
      `http://example.com/api/files/${fileId}`,
      { headers: { Cookie: firstUser.sessionCookie } },
    );
    expect(ownerResponse.status).toBe(200);
  });

  it("returns 404 when a catalog row points to a missing R2 object", async () => {
    const content = new TextEncoder().encode("missing-r2-object");
    const fileId = await computeFileId(toArrayBuffer(content));
    const db = drizzle(env.DATABASE);
    await db.insert(fileStorage).values({
      id: fileId,
      userId: firstUser.userId,
      r2Key: createR2Key(firstUser.userId, fileId),
      fileSize: content.byteLength,
      mediaType: "text/plain",
    });

    const response = await SELF.fetch(
      `http://example.com/api/files/${fileId}`,
      { headers: { Cookie: firstUser.sessionCookie } },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "File not found in storage",
    });
  });

  it("requires authentication for every file operation", async () => {
    const content = new TextEncoder().encode("unauthenticated-file");
    const fileId = await computeFileId(toArrayBuffer(content));

    const responses = await Promise.all([
      SELF.fetch(`http://example.com/api/files/${fileId}`, {
        method: "PUT",
        body: content,
      }),
      SELF.fetch(`http://example.com/api/files/${fileId}`),
      SELF.fetch("http://example.com/api/files"),
      SELF.fetch(`http://example.com/api/files/${fileId}`, {
        method: "DELETE",
      }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([
      401, 401, 401, 401,
    ]);
  });

  it("does not expose the retired type-specific routes", async () => {
    const responses = await Promise.all([
      SELF.fetch("http://example.com/api/files/upload", {
        method: "POST",
        headers: { Cookie: firstUser.sessionCookie },
      }),
      SELF.fetch("http://example.com/api/files/epub/1111111111111111", {
        headers: { Cookie: firstUser.sessionCookie },
      }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([404, 404]);
  });
});
