import { env, SELF } from "cloudflare:test";
import { book } from "@server/db/schema";
import { drizzle } from "drizzle-orm/d1";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createTestEpubContent,
  createTestImageContent,
  createTestUser,
  uploadTestFile,
} from "./helpers";

describe("GET /api/files/:userId/*", () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>;
  let anotherUser: Awaited<ReturnType<typeof createTestUser>>;

  beforeAll(async () => {
    testUser = await createTestUser(
      "filetest@example.com",
      "testpassword123",
      "File Test User",
    );
    anotherUser = await createTestUser(
      "anotherfiletest@example.com",
      "testpassword456",
      "Another File Test User",
    );
  });

  it("returns 401 for unauthenticated requests", async () => {
    const response = await SELF.fetch(
      `http://example.com/api/files/${testUser.userId}/epubs/${testUser.userId}/test.epub`,
    );

    expect(response.status).toBe(401);
    const data = (await response.json()) as { error: string };
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 403 when trying to access another user's files", async () => {
    const response = await SELF.fetch(
      `http://example.com/api/files/${anotherUser.userId}/epubs/${anotherUser.userId}/test.epub`,
      {
        headers: {
          Cookie: testUser.sessionCookie,
        },
      },
    );

    expect(response.status).toBe(403);
    const data = (await response.json()) as { error: string };
    expect(data.error).toBe("Forbidden");
  });

  it("returns 400 when file path is missing", async () => {
    const response = await SELF.fetch(
      `http://example.com/api/files/${testUser.userId}/`,
      {
        headers: {
          Cookie: testUser.sessionCookie,
        },
      },
    );

    expect(response.status).toBe(400);
    const data = (await response.json()) as { error: string };
    expect(data.error).toBe("File path is required");
  });

  it("returns 404 when file does not exist in R2", async () => {
    const response = await SELF.fetch(
      `http://example.com/api/files/${testUser.userId}/epubs/${testUser.userId}/nonexistent.epub`,
      {
        headers: {
          Cookie: testUser.sessionCookie,
        },
      },
    );

    expect(response.status).toBe(404);
    const data = (await response.json()) as { error: string };
    expect(data.error).toBe("File not found");
  });

  it("returns EPUB file with correct headers when file exists", async () => {
    const fileHash = "test-epub-hash-123";
    const r2Key = `epubs/${testUser.userId}/${fileHash}.epub`;
    const epubContent = createTestEpubContent();

    // Upload test file to R2
    await uploadTestFile(r2Key, epubContent, "application/epub+zip");

    const response = await SELF.fetch(
      `http://example.com/api/files/${testUser.userId}/${r2Key}`,
      {
        headers: {
          Cookie: testUser.sessionCookie,
        },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/epub+zip");
    expect(response.headers.get("cache-control")).toBe(
      "private, max-age=31536000, immutable",
    );
    expect(response.headers.get("content-length")).toBe(
      epubContent.length.toString(),
    );
    expect(response.headers.get("etag")).toBeDefined();

    // Verify body content
    const body = await response.arrayBuffer();
    expect(new Uint8Array(body)).toEqual(epubContent);
  });

  it("returns PNG image with correct content-type", async () => {
    const fileHash = "test-cover-hash-456";
    const r2Key = `covers/${testUser.userId}/${fileHash}.png`;
    const imageContent = createTestImageContent();

    // Upload test file to R2
    await uploadTestFile(r2Key, imageContent, "image/png");

    const response = await SELF.fetch(
      `http://example.com/api/files/${testUser.userId}/${r2Key}`,
      {
        headers: {
          Cookie: testUser.sessionCookie,
        },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe(
      "private, max-age=31536000, immutable",
    );

    // Consume the response body to avoid isolated storage issues
    const body = await response.arrayBuffer();
    expect(new Uint8Array(body)).toEqual(imageContent);
  });

  it("returns JPEG image with correct content-type", async () => {
    const fileHash = "test-cover-hash-789";
    const r2Key = `covers/${testUser.userId}/${fileHash}.jpg`;
    const imageContent = new TextEncoder().encode("Mock JPEG content");

    await uploadTestFile(r2Key, imageContent, "image/jpeg");

    const response = await SELF.fetch(
      `http://example.com/api/files/${testUser.userId}/${r2Key}`,
      {
        headers: {
          Cookie: testUser.sessionCookie,
        },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");

    // Consume the response body
    await response.arrayBuffer();
  });

  it("returns WEBP image with correct content-type", async () => {
    const fileHash = "test-cover-hash-webp";
    const r2Key = `covers/${testUser.userId}/${fileHash}.webp`;
    const imageContent = new TextEncoder().encode("Mock WEBP content");

    await uploadTestFile(r2Key, imageContent, "image/webp");

    const response = await SELF.fetch(
      `http://example.com/api/files/${testUser.userId}/${r2Key}`,
      {
        headers: {
          Cookie: testUser.sessionCookie,
        },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");

    // Consume the response body
    await response.arrayBuffer();
  });

  it("includes proper cache control headers for long-term caching", async () => {
    const fileHash = "test-cache-headers";
    const r2Key = `epubs/${testUser.userId}/${fileHash}.epub`;
    const epubContent = createTestEpubContent();

    await uploadTestFile(r2Key, epubContent, "application/epub+zip");

    const response = await SELF.fetch(
      `http://example.com/api/files/${testUser.userId}/${r2Key}`,
      {
        headers: {
          Cookie: testUser.sessionCookie,
        },
      },
    );

    expect(response.status).toBe(200);

    // Verify cache control components
    const cacheControl = response.headers.get("cache-control");
    expect(cacheControl).toContain("private"); // No CDN/proxy caching
    expect(cacheControl).toContain("max-age=31536000"); // 1 year
    expect(cacheControl).toContain("immutable"); // Won't change

    // Consume the response body
    await response.arrayBuffer();
  });

  describe("GET /api/files/:fileType/:contentHash (content-addressed)", () => {
    let testUser: Awaited<ReturnType<typeof createTestUser>>;

    beforeAll(async () => {
      testUser = await createTestUser(
        "contentaddressed@example.com",
        "testpassword123",
        "Content Addressed Test User",
      );
    });

    it("returns 401 for unauthenticated requests", async () => {
      const response = await SELF.fetch(
        "http://example.com/api/files/epub/somehash123",
      );

      expect(response.status).toBe(401);
      const data = (await response.json()) as { error: string };
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 400 for invalid file type", async () => {
      const response = await SELF.fetch(
        "http://example.com/api/files/invalid/somehash123",
        {
          headers: {
            Cookie: testUser.sessionCookie,
          },
        },
      );

      expect(response.status).toBe(400);
      const data = (await response.json()) as { error: string };
      expect(data.error).toBe("Invalid file type. Must be 'epub' or 'cover'");
    });

    it("returns 404 when book does not exist", async () => {
      const response = await SELF.fetch(
        "http://example.com/api/files/epub/nonexistent-hash",
        {
          headers: {
            Cookie: testUser.sessionCookie,
          },
        },
      );

      expect(response.status).toBe(404);
      const data = (await response.json()) as { error: string };
      expect(data.error).toBe("File not found");
    });

    it("returns 404 when book exists but has no R2 key", async () => {
      const db = drizzle(env.DATABASE);
      const fileHash = "no-r2-key-hash";

      // Insert a book without R2 keys
      await db.insert(book).values({
        id: crypto.randomUUID(),
        userId: testUser.userId,
        fileHash,
        title: "Test Book No R2",
        author: "Test Author",
        fileSize: 1000,
      });

      const response = await SELF.fetch(
        `http://example.com/api/files/epub/${fileHash}`,
        {
          headers: {
            Cookie: testUser.sessionCookie,
          },
        },
      );

      expect(response.status).toBe(404);
      const data = (await response.json()) as { error: string };
      expect(data.error).toBe("File not found");
    });

    it("returns EPUB file when book has R2 key", async () => {
      const db = drizzle(env.DATABASE);
      const fileHash = "content-addressed-epub-hash";
      const r2Key = `epubs/${testUser.userId}/${fileHash}.epub`;
      const epubContent = createTestEpubContent();

      // Insert book with R2 key
      await db.insert(book).values({
        id: crypto.randomUUID(),
        userId: testUser.userId,
        fileHash,
        title: "Test Book With R2",
        author: "Test Author",
        fileSize: epubContent.length,
        epubR2Key: r2Key,
      });

      // Upload file to R2
      await uploadTestFile(r2Key, epubContent, "application/epub+zip");

      const response = await SELF.fetch(
        `http://example.com/api/files/epub/${fileHash}`,
        {
          headers: {
            Cookie: testUser.sessionCookie,
          },
        },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/epub+zip");
      expect(response.headers.get("cache-control")).toBe(
        "private, max-age=31536000, immutable",
      );

      const body = await response.arrayBuffer();
      expect(new Uint8Array(body)).toEqual(epubContent);
    });

    it("returns cover image when book has cover R2 key", async () => {
      const db = drizzle(env.DATABASE);
      const fileHash = "content-addressed-cover-hash";
      const r2Key = `covers/${testUser.userId}/${fileHash}.png`;
      const imageContent = createTestImageContent();

      // Insert book with cover R2 key
      await db.insert(book).values({
        id: crypto.randomUUID(),
        userId: testUser.userId,
        fileHash,
        title: "Test Book With Cover",
        author: "Test Author",
        fileSize: 1000,
        coverR2Key: r2Key,
      });

      // Upload cover to R2
      await uploadTestFile(r2Key, imageContent, "image/png");

      const response = await SELF.fetch(
        `http://example.com/api/files/cover/${fileHash}`,
        {
          headers: {
            Cookie: testUser.sessionCookie,
          },
        },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");

      const body = await response.arrayBuffer();
      expect(new Uint8Array(body)).toEqual(imageContent);
    });

    it("returns correct content-type for JPEG covers", async () => {
      const db = drizzle(env.DATABASE);
      const fileHash = "content-addressed-jpeg-cover";
      const r2Key = `covers/${testUser.userId}/${fileHash}.jpg`;
      const imageContent = new TextEncoder().encode("Mock JPEG content");

      await db.insert(book).values({
        id: crypto.randomUUID(),
        userId: testUser.userId,
        fileHash,
        title: "Test Book JPEG Cover",
        author: "Test Author",
        fileSize: 1000,
        coverR2Key: r2Key,
      });

      await uploadTestFile(r2Key, imageContent, "image/jpeg");

      const response = await SELF.fetch(
        `http://example.com/api/files/cover/${fileHash}`,
        {
          headers: {
            Cookie: testUser.sessionCookie,
          },
        },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/jpeg");

      await response.arrayBuffer();
    });

    it("does not allow accessing another user's files", async () => {
      const db = drizzle(env.DATABASE);
      const fileHash = "other-user-file-hash";

      // Create another user
      const otherUser = await createTestUser(
        "otheruser-files@example.com",
        "testpassword456",
        "Other User",
      );

      // Insert book for other user
      await db.insert(book).values({
        id: crypto.randomUUID(),
        userId: otherUser.userId,
        fileHash,
        title: "Other User Book",
        author: "Other Author",
        fileSize: 1000,
        epubR2Key: `epubs/${otherUser.userId}/${fileHash}.epub`,
      });

      // Try to access with testUser's credentials - should not find it
      const response = await SELF.fetch(
        `http://example.com/api/files/epub/${fileHash}`,
        {
          headers: {
            Cookie: testUser.sessionCookie,
          },
        },
      );

      // Should return 404 because the lookup is scoped to the authenticated user
      expect(response.status).toBe(404);
    });
  });

  it("handles files without extensions correctly", async () => {
    const fileHash = "test-no-ext";
    const r2Key = `covers/${testUser.userId}/${fileHash}`;
    const content = new TextEncoder().encode("Mock content");

    await uploadTestFile(r2Key, content);

    const response = await SELF.fetch(
      `http://example.com/api/files/${testUser.userId}/${r2Key}`,
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

    // Consume the response body
    await response.arrayBuffer();
  });
});
