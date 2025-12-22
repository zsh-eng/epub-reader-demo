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

describe("POST /api/files/upload", () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>;
  let anotherUser: Awaited<ReturnType<typeof createTestUser>>;

  beforeAll(async () => {
    testUser = await createTestUser(
      "uploadtest@example.com",
      "testpassword123",
      "Upload Test User",
    );

    anotherUser = await createTestUser(
      "uploadtest2@example.com",
      "testpassword456",
      "Another Upload User",
    );
  });

  it("successfully uploads a new file", async () => {
    const fileContent = createTestImageContent();
    const fileName = "test-upload.png";
    const fileType = "cover";

    const formData = new FormData();
    formData.append(
      "file",
      new File([fileContent], fileName, { type: "image/png" }),
    );
    formData.append("fileType", fileType);

    const response = await SELF.fetch("http://example.com/api/files/upload", {
      method: "POST",
      headers: {
        Cookie: testUser.sessionCookie,
      },
      body: formData,
    });

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.contentHash).toBeDefined();
    expect(data.fileName).toBe(fileName);
    expect(data.fileSize).toBe(fileContent.length);
    expect(data.mimeType).toBe("image/png");
    expect(data.alreadyExists).toBe(false);

    // Verify file is in database
    const db = drizzle(env.DATABASE);
    const dbFile = await db
      .select()
      .from(fileStorage)
      .where(sql`${fileStorage.contentHash} = ${data.contentHash}`)
      .get();

    expect(dbFile).toBeDefined();
    expect(dbFile?.userId).toBe(testUser.userId);
    expect(dbFile?.fileType).toBe(fileType);
    expect(dbFile?.fileName).toBe(fileName);
    expect(dbFile?.fileSize).toBe(fileContent.length);
    expect(dbFile?.mimeType).toBe("image/png");

    // Verify file is in R2
    const r2Object = await env.BOOK_STORAGE.get(dbFile!.r2Key);
    expect(r2Object).toBeDefined();
    expect(r2Object?.size).toBe(fileContent.length);
    // Consume the body to avoid storage isolation issues
    if (r2Object?.body) {
      await r2Object.body.cancel();
    }
  });

  it("returns existing file metadata when uploading duplicate content", async () => {
    const fileContent = createTestImageContent();
    const fileName1 = "first-upload.png";
    const fileName2 = "second-upload-same-content.png";
    const fileType = "cover";

    const formData1 = new FormData();
    formData1.append(
      "file",
      new File([fileContent], fileName1, { type: "image/png" }),
    );
    formData1.append("fileType", fileType);

    // First upload
    const response1 = await SELF.fetch("http://example.com/api/files/upload", {
      method: "POST",
      headers: {
        Cookie: testUser.sessionCookie,
      },
      body: formData1,
    });

    expect(response1.status).toBe(200);
    const data1 = await response1.json();
    expect(data1.alreadyExists).toBe(false);

    // Second upload with same content but different filename
    const formData2 = new FormData();
    formData2.append(
      "file",
      new File([fileContent], fileName2, { type: "image/png" }),
    );
    formData2.append("fileType", fileType);

    const response2 = await SELF.fetch("http://example.com/api/files/upload", {
      method: "POST",
      headers: {
        Cookie: testUser.sessionCookie,
      },
      body: formData2,
    });

    expect(response2.status).toBe(200);
    const data2 = await response2.json();

    expect(data2.success).toBe(true);
    expect(data2.contentHash).toBe(data1.contentHash);
    expect(data2.alreadyExists).toBe(true);
    expect(data2.fileName).toBe(fileName1); // Returns original filename

    // Verify only one entry in database
    const db = drizzle(env.DATABASE);
    const dbFiles = await db
      .select()
      .from(fileStorage)
      .where(sql`${fileStorage.contentHash} = ${data1.contentHash}`)
      .all();

    expect(dbFiles.length).toBe(1);
  });

  it("allows different users to upload the same file content", async () => {
    const fileContent = new TextEncoder().encode("shared file content");
    const fileName = "shared.txt";
    const fileType = "document";

    // User 1 uploads
    const formData1 = new FormData();
    formData1.append(
      "file",
      new File([fileContent], fileName, { type: "text/plain" }),
    );
    formData1.append("fileType", fileType);

    const response1 = await SELF.fetch("http://example.com/api/files/upload", {
      method: "POST",
      headers: {
        Cookie: testUser.sessionCookie,
      },
      body: formData1,
    });

    expect(response1.status).toBe(200);
    const data1 = await response1.json();
    expect(data1.alreadyExists).toBe(false);

    // User 2 uploads same content
    const formData2 = new FormData();
    formData2.append(
      "file",
      new File([fileContent], fileName, { type: "text/plain" }),
    );
    formData2.append("fileType", fileType);

    const response2 = await SELF.fetch("http://example.com/api/files/upload", {
      method: "POST",
      headers: {
        Cookie: anotherUser.sessionCookie,
      },
      body: formData2,
    });

    expect(response2.status).toBe(200);
    const data2 = await response2.json();
    expect(data2.alreadyExists).toBe(false); // New for this user

    // Verify both users have entries in database
    const db = drizzle(env.DATABASE);
    const dbFiles = await db
      .select()
      .from(fileStorage)
      .where(sql`${fileStorage.contentHash} = ${data1.contentHash}`)
      .all();

    expect(dbFiles.length).toBe(2);
    const userIds = dbFiles.map((f) => f.userId).sort();
    expect(userIds).toEqual([testUser.userId, anotherUser.userId].sort());
  });

  it("allows same user to upload same content hash with different file types", async () => {
    const fileContent = createTestImageContent();
    const fileName = "multi-type.png";

    // Upload as 'cover'
    const formData1 = new FormData();
    formData1.append(
      "file",
      new File([fileContent], fileName, { type: "image/png" }),
    );
    formData1.append("fileType", "cover");

    const response1 = await SELF.fetch("http://example.com/api/files/upload", {
      method: "POST",
      headers: {
        Cookie: testUser.sessionCookie,
      },
      body: formData1,
    });

    expect(response1.status).toBe(200);
    const data1 = await response1.json();
    expect(data1.alreadyExists).toBe(false);

    // Upload same content as 'thumbnail'
    const formData2 = new FormData();
    formData2.append(
      "file",
      new File([fileContent], fileName, { type: "image/png" }),
    );
    formData2.append("fileType", "thumbnail");

    const response2 = await SELF.fetch("http://example.com/api/files/upload", {
      method: "POST",
      headers: {
        Cookie: testUser.sessionCookie,
      },
      body: formData2,
    });

    expect(response2.status).toBe(200);
    const data2 = await response2.json();
    expect(data2.contentHash).toBe(data1.contentHash);
    expect(data2.alreadyExists).toBe(false); // Different fileType

    // Verify both entries exist
    const db = drizzle(env.DATABASE);
    const dbFiles = await db
      .select()
      .from(fileStorage)
      .where(
        sql`${fileStorage.userId} = ${testUser.userId} AND ${fileStorage.contentHash} = ${data1.contentHash}`,
      )
      .all();

    expect(dbFiles.length).toBe(2);
    const fileTypes = dbFiles.map((f) => f.fileType).sort();
    expect(fileTypes).toEqual(["cover", "thumbnail"]);
  });

  it("returns 401 for unauthenticated requests", async () => {
    const fileContent = createTestImageContent();
    const formData = new FormData();
    formData.append(
      "file",
      new File([fileContent], "test.png", { type: "image/png" }),
    );
    formData.append("fileType", "cover");

    const response = await SELF.fetch("http://example.com/api/files/upload", {
      method: "POST",
      body: formData,
    });

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 400 when file is missing", async () => {
    const formData = new FormData();
    formData.append("fileType", "cover");

    const response = await SELF.fetch("http://example.com/api/files/upload", {
      method: "POST",
      headers: {
        Cookie: testUser.sessionCookie,
      },
      body: formData,
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("No file provided");
  });

  it("returns 400 when fileType is missing", async () => {
    const fileContent = createTestImageContent();
    const formData = new FormData();
    formData.append(
      "file",
      new File([fileContent], "test.png", { type: "image/png" }),
    );

    const response = await SELF.fetch("http://example.com/api/files/upload", {
      method: "POST",
      headers: {
        Cookie: testUser.sessionCookie,
      },
      body: formData,
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("File type is required");
  });

  it("returns 400 when fileType is empty string", async () => {
    const fileContent = createTestImageContent();
    const formData = new FormData();
    formData.append(
      "file",
      new File([fileContent], "test.png", { type: "image/png" }),
    );
    formData.append("fileType", "");

    const response = await SELF.fetch("http://example.com/api/files/upload", {
      method: "POST",
      headers: {
        Cookie: testUser.sessionCookie,
      },
      body: formData,
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("File type is required");
  });

  it("handles files without MIME type", async () => {
    const fileContent = new TextEncoder().encode("plain text");
    const fileName = "no-mime-type.txt";
    const fileType = "document";

    const formData = new FormData();
    formData.append("file", new File([fileContent], fileName));
    formData.append("fileType", fileType);

    const response = await SELF.fetch("http://example.com/api/files/upload", {
      method: "POST",
      headers: {
        Cookie: testUser.sessionCookie,
      },
      body: formData,
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.mimeType).toBe("application/octet-stream");
  });

  it("successfully uploads large files", async () => {
    // Create a 2MB file
    const largeContent = new Uint8Array(2 * 1024 * 1024).fill(123);
    const fileName = "large-file.bin";
    const fileType = "binary";

    const formData = new FormData();
    formData.append(
      "file",
      new File([largeContent], fileName, { type: "application/octet-stream" }),
    );
    formData.append("fileType", fileType);

    const response = await SELF.fetch("http://example.com/api/files/upload", {
      method: "POST",
      headers: {
        Cookie: testUser.sessionCookie,
      },
      body: formData,
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.fileSize).toBe(largeContent.length);

    // Verify file is in R2
    const db = drizzle(env.DATABASE);
    const dbFile = await db
      .select()
      .from(fileStorage)
      .where(sql`${fileStorage.contentHash} = ${data.contentHash}`)
      .get();

    const r2Object = await env.BOOK_STORAGE.get(dbFile!.r2Key);
    expect(r2Object?.size).toBe(largeContent.length);
    // Consume the body to avoid storage isolation issues
    if (r2Object?.body) {
      await r2Object.body.cancel();
    }
  });

  it("handles EPUB file uploads", async () => {
    const epubContent = new TextEncoder().encode("Mock EPUB content");
    const fileName = "test-book.epub";
    const fileType = "epub";

    const formData = new FormData();
    formData.append(
      "file",
      new File([epubContent], fileName, { type: "application/epub+zip" }),
    );
    formData.append("fileType", fileType);

    const response = await SELF.fetch("http://example.com/api/files/upload", {
      method: "POST",
      headers: {
        Cookie: testUser.sessionCookie,
      },
      body: formData,
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.mimeType).toBe("application/epub+zip");
    expect(data.fileName).toBe(fileName);
  });
});

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
