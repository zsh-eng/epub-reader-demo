import { env, SELF } from "cloudflare:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeAll, describe, expect, it } from "vitest";
import { fileStorage } from "../../server/db/schema";
import {
  createTestImageContent,
  createTestUser,
  uploadTestFile,
} from "./helpers";

describe("GET /api/files/:fileType/:contentHash", () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>;
  let anotherUser: Awaited<ReturnType<typeof createTestUser>>;

  const testContentHash = "abc123def456";
  const testR2Key = `test-files/${testContentHash}.png`;
  const testFileType = "cover";
  const testMimeType = "image/png";
  const testFileContent = createTestImageContent();

  beforeAll(async () => {
    testUser = await createTestUser(
      "filetest@example.com",
      "testpassword123",
      "File Test User",
    );

    anotherUser = await createTestUser(
      "anotheruser@example.com",
      "testpassword456",
      "Another User",
    );

    // Upload test file to R2
    await uploadTestFile(testR2Key, testFileContent, testMimeType);

    // Insert file metadata into database for testUser
    const db = drizzle(env.DATABASE);
    await db.insert(fileStorage).values({
      id: crypto.randomUUID(),
      userId: testUser.userId,
      contentHash: testContentHash,
      fileType: testFileType,
      r2Key: testR2Key,
      fileName: "test-cover.png",
      fileSize: testFileContent.length,
      mimeType: testMimeType,
      metadata: { test: true },
    });
  });

  it("successfully downloads a file for authenticated user who owns it", async () => {
    const response = await SELF.fetch(
      `http://example.com/api/files/${testFileType}/${testContentHash}`,
      {
        headers: {
          Cookie: testUser.sessionCookie,
        },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(testMimeType);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("max-age=31536000");
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(response.headers.get("content-length")).toBe(
      testFileContent.length.toString(),
    );
    expect(response.headers.get("etag")).toBeDefined();

    const responseBody = await response.arrayBuffer();
    expect(new Uint8Array(responseBody)).toEqual(testFileContent);
  });

  it("returns 401 for unauthenticated requests", async () => {
    const response = await SELF.fetch(
      `http://example.com/api/files/${testFileType}/${testContentHash}`,
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");

    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 401 for requests with invalid session cookie", async () => {
    const response = await SELF.fetch(
      `http://example.com/api/files/${testFileType}/${testContentHash}`,
      {
        headers: {
          Cookie: "better-auth.session_token=invalid-token-123",
        },
      },
    );

    expect(response.status).toBe(401);

    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 404 when authenticated user tries to access another user's file", async () => {
    const response = await SELF.fetch(
      `http://example.com/api/files/${testFileType}/${testContentHash}`,
      {
        headers: {
          Cookie: anotherUser.sessionCookie,
        },
      },
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");

    const data = await response.json();
    expect(data.error).toBe("File not found");
  });

  it("returns 404 for non-existent content hash", async () => {
    const nonExistentHash = "nonexistent123";

    const response = await SELF.fetch(
      `http://example.com/api/files/${testFileType}/${nonExistentHash}`,
      {
        headers: {
          Cookie: testUser.sessionCookie,
        },
      },
    );

    expect(response.status).toBe(404);

    const data = await response.json();
    expect(data.error).toBe("File not found");
  });

  it("returns 404 for soft-deleted files", async () => {
    const deletedContentHash = "deleted789";
    const deletedR2Key = `test-files/${deletedContentHash}.png`;

    // Upload file to R2
    await uploadTestFile(deletedR2Key, testFileContent, testMimeType);

    // Insert file metadata with deletedAt timestamp
    const db = drizzle(env.DATABASE);
    await db.insert(fileStorage).values({
      id: crypto.randomUUID(),
      userId: testUser.userId,
      contentHash: deletedContentHash,
      fileType: testFileType,
      r2Key: deletedR2Key,
      fileName: "deleted-file.png",
      fileSize: testFileContent.length,
      mimeType: testMimeType,
      deletedAt: new Date(),
    });

    const response = await SELF.fetch(
      `http://example.com/api/files/${testFileType}/${deletedContentHash}`,
      {
        headers: {
          Cookie: testUser.sessionCookie,
        },
      },
    );

    expect(response.status).toBe(404);

    const data = await response.json();
    expect(data.error).toBe("File not found");
  });

  it("returns 404 when file exists in DB but not in R2", async () => {
    const orphanedContentHash = "orphaned456";
    const orphanedR2Key = `test-files/${orphanedContentHash}.png`;

    // Insert file metadata WITHOUT uploading to R2
    const db = drizzle(env.DATABASE);
    await db.insert(fileStorage).values({
      id: crypto.randomUUID(),
      userId: testUser.userId,
      contentHash: orphanedContentHash,
      fileType: testFileType,
      r2Key: orphanedR2Key,
      fileName: "orphaned-file.png",
      fileSize: testFileContent.length,
      mimeType: testMimeType,
    });

    const response = await SELF.fetch(
      `http://example.com/api/files/${testFileType}/${orphanedContentHash}`,
      {
        headers: {
          Cookie: testUser.sessionCookie,
        },
      },
    );

    expect(response.status).toBe(404);

    const data = await response.json();
    expect(data.error).toBe("File not found in storage");
  });

  it("correctly distinguishes between different file types for same content hash", async () => {
    const sharedContentHash = "shared999";
    const epubR2Key = `test-files/${sharedContentHash}.epub`;
    const coverR2Key = `test-files/${sharedContentHash}-cover.png`;
    const epubFileType = "epub";
    const coverFileType = "cover";

    // Upload different files to R2
    const epubContent = new TextEncoder().encode("EPUB content");
    const coverContent = testFileContent;

    await uploadTestFile(epubR2Key, epubContent, "application/epub+zip");
    await uploadTestFile(coverR2Key, coverContent, "image/png");

    // Insert both file types with same content hash
    const db = drizzle(env.DATABASE);
    await db.insert(fileStorage).values([
      {
        id: crypto.randomUUID(),
        userId: testUser.userId,
        contentHash: sharedContentHash,
        fileType: epubFileType,
        r2Key: epubR2Key,
        fileName: "test.epub",
        fileSize: epubContent.length,
        mimeType: "application/epub+zip",
      },
      {
        id: crypto.randomUUID(),
        userId: testUser.userId,
        contentHash: sharedContentHash,
        fileType: coverFileType,
        r2Key: coverR2Key,
        fileName: "test-cover.png",
        fileSize: coverContent.length,
        mimeType: "image/png",
      },
    ]);

    // Request the EPUB
    const epubResponse = await SELF.fetch(
      `http://example.com/api/files/${epubFileType}/${sharedContentHash}`,
      {
        headers: {
          Cookie: testUser.sessionCookie,
        },
      },
    );

    expect(epubResponse.status).toBe(200);
    expect(epubResponse.headers.get("content-type")).toBe(
      "application/epub+zip",
    );
    const epubBody = await epubResponse.arrayBuffer();
    expect(new Uint8Array(epubBody)).toEqual(epubContent);

    // Request the cover
    const coverResponse = await SELF.fetch(
      `http://example.com/api/files/${coverFileType}/${sharedContentHash}`,
      {
        headers: {
          Cookie: testUser.sessionCookie,
        },
      },
    );

    expect(coverResponse.status).toBe(200);
    expect(coverResponse.headers.get("content-type")).toBe("image/png");
    const coverBody = await coverResponse.arrayBuffer();
    expect(new Uint8Array(coverBody)).toEqual(coverContent);
  });

  it("handles large file downloads correctly", async () => {
    const largeContentHash = "large123";
    const largeR2Key = `test-files/${largeContentHash}.bin`;
    // Create a 1MB file
    const largeContent = new Uint8Array(1024 * 1024).fill(42);

    await uploadTestFile(largeR2Key, largeContent, "application/octet-stream");

    const db = drizzle(env.DATABASE);
    await db.insert(fileStorage).values({
      id: crypto.randomUUID(),
      userId: testUser.userId,
      contentHash: largeContentHash,
      fileType: "binary",
      r2Key: largeR2Key,
      fileName: "large-file.bin",
      fileSize: largeContent.length,
      mimeType: "application/octet-stream",
    });

    const response = await SELF.fetch(
      `http://example.com/api/files/binary/${largeContentHash}`,
      {
        headers: {
          Cookie: testUser.sessionCookie,
        },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/octet-stream",
    );
    expect(response.headers.get("content-length")).toBe(
      largeContent.length.toString(),
    );

    const responseBody = await response.arrayBuffer();
    expect(responseBody.byteLength).toBe(largeContent.length);
  });
});
