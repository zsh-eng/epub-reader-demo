import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestUser, type TestUser } from "./helpers";

describe("Book Sync API", () => {
  let testUser: TestUser;

  beforeAll(async () => {
    testUser = await createTestUser(
      "booksync@example.com",
      "testpassword123",
      "Book Sync Test User",
    );
  });

  describe("GET /api/sync/books", () => {
    it("returns empty array when no books exist", async () => {
      const response = await SELF.fetch("http://example.com/api/sync/books", {
        headers: {
          Cookie: testUser.sessionCookie,
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.books).toEqual([]);
      expect(data.serverTimestamp).toBeDefined();
      expect(typeof data.serverTimestamp).toBe("number");
    });

    it("returns 401 for unauthenticated requests", async () => {
      const response = await SELF.fetch("http://example.com/api/sync/books");

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("POST /api/sync/books", () => {
    it("creates a new book", async () => {
      const response = await SELF.fetch("http://example.com/api/sync/books", {
        method: "POST",
        headers: {
          Cookie: testUser.sessionCookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          books: [
            {
              fileHash: "abc123def456",
              title: "Test Book",
              author: "Test Author",
              fileSize: 1024000,
              metadata: { language: "en", publisher: "Test Publisher" },
            },
          ],
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.results).toHaveLength(1);
      expect(data.results[0].fileHash).toBe("abc123def456");
      expect(data.results[0].status).toBe("created");
      expect(data.results[0].serverId).toBeDefined();
    });

    it("returns exists for duplicate book", async () => {
      // First, create the book
      await SELF.fetch("http://example.com/api/sync/books", {
        method: "POST",
        headers: {
          Cookie: testUser.sessionCookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          books: [
            {
              fileHash: "duplicate123",
              title: "Duplicate Book",
              author: "Duplicate Author",
              fileSize: 500000,
            },
          ],
        }),
      });

      // Then try to create the same book again
      const response = await SELF.fetch("http://example.com/api/sync/books", {
        method: "POST",
        headers: {
          Cookie: testUser.sessionCookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          books: [
            {
              fileHash: "duplicate123",
              title: "Duplicate Book",
              author: "Duplicate Author",
              fileSize: 500000,
            },
          ],
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.results).toHaveLength(1);
      expect(data.results[0].fileHash).toBe("duplicate123");
      expect(data.results[0].status).toBe("exists");
    });

    it("creates multiple books at once", async () => {
      const response = await SELF.fetch("http://example.com/api/sync/books", {
        method: "POST",
        headers: {
          Cookie: testUser.sessionCookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          books: [
            {
              fileHash: "multi1",
              title: "Multi Book 1",
              author: "Author 1",
              fileSize: 100000,
            },
            {
              fileHash: "multi2",
              title: "Multi Book 2",
              author: "Author 2",
              fileSize: 200000,
            },
          ],
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.results).toHaveLength(2);
      expect(data.results[0].status).toBe("created");
      expect(data.results[1].status).toBe("created");
    });

    it("returns 400 for invalid request body", async () => {
      const response = await SELF.fetch("http://example.com/api/sync/books", {
        method: "POST",
        headers: {
          Cookie: testUser.sessionCookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ invalid: "data" }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      // zValidator wraps ZodError in { success: false, error: ZodError }
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
      expect(data.error.name).toBe("ZodError");
      expect(data.error.message).toBeDefined();
      expect(data.error.message.length).toBeGreaterThan(0);
    });

    it("returns 401 for unauthenticated requests", async () => {
      const response = await SELF.fetch("http://example.com/api/sync/books", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          books: [
            {
              fileHash: "unauth123",
              title: "Unauth Book",
              author: "Unauth Author",
              fileSize: 100000,
            },
          ],
        }),
      });

      expect(response.status).toBe(401);
    });
  });

  describe("GET /api/sync/books with since parameter", () => {
    it("returns books updated after since timestamp", async () => {
      // Create a book first
      await SELF.fetch("http://example.com/api/sync/books", {
        method: "POST",
        headers: {
          Cookie: testUser.sessionCookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          books: [
            {
              fileHash: "since_test_123",
              title: "Since Test Book",
              author: "Since Author",
              fileSize: 300000,
            },
          ],
        }),
      });

      // Get books with since=0 (should return all)
      const response = await SELF.fetch(
        "http://example.com/api/sync/books?since=0",
        {
          headers: {
            Cookie: testUser.sessionCookie,
          },
        },
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.books.length).toBeGreaterThan(0);

      // Get with a future timestamp (should return none)
      const futureTime = Date.now() + 100000;
      const futureResponse = await SELF.fetch(
        `http://example.com/api/sync/books?since=${futureTime}`,
        {
          headers: {
            Cookie: testUser.sessionCookie,
          },
        },
      );

      expect(futureResponse.status).toBe(200);
      const futureData = await futureResponse.json();
      expect(futureData.books).toEqual([]);
    });
  });

  describe("DELETE /api/sync/books/:fileHash", () => {
    it("soft deletes a book", async () => {
      // Create a book first
      await SELF.fetch("http://example.com/api/sync/books", {
        method: "POST",
        headers: {
          Cookie: testUser.sessionCookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          books: [
            {
              fileHash: "to_delete_123",
              title: "Book to Delete",
              author: "Delete Author",
              fileSize: 400000,
            },
          ],
        }),
      });

      // Delete the book
      const deleteResponse = await SELF.fetch(
        "http://example.com/api/sync/books/to_delete_123",
        {
          method: "DELETE",
          headers: {
            Cookie: testUser.sessionCookie,
          },
        },
      );

      expect(deleteResponse.status).toBe(200);
      const deleteData = await deleteResponse.json();
      expect(deleteData.success).toBe(true);
      expect(deleteData.fileHash).toBe("to_delete_123");
      expect(deleteData.deletedAt).toBeDefined();

      // Verify the book appears as deleted in sync
      const syncResponse = await SELF.fetch(
        "http://example.com/api/sync/books?since=0",
        {
          headers: {
            Cookie: testUser.sessionCookie,
          },
        },
      );

      const syncData = await syncResponse.json();
      const deletedBook = syncData.books.find(
        (b: { fileHash: string }) => b.fileHash === "to_delete_123",
      );
      expect(deletedBook).toBeDefined();
      expect(deletedBook.deletedAt).not.toBeNull();
    });

    it("returns 404 for non-existent book", async () => {
      const response = await SELF.fetch(
        "http://example.com/api/sync/books/nonexistent_hash",
        {
          method: "DELETE",
          headers: {
            Cookie: testUser.sessionCookie,
          },
        },
      );

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("Book not found");
    });

    it("returns 401 for unauthenticated requests", async () => {
      const response = await SELF.fetch(
        "http://example.com/api/sync/books/some_hash",
        {
          method: "DELETE",
        },
      );

      expect(response.status).toBe(401);
    });
  });

  describe("POST /api/sync/books/:fileHash/upload-complete", () => {
    it("marks epub upload as complete", async () => {
      // Create a book first
      await SELF.fetch("http://example.com/api/sync/books", {
        method: "POST",
        headers: {
          Cookie: testUser.sessionCookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          books: [
            {
              fileHash: "upload_test_123",
              title: "Upload Test Book",
              author: "Upload Author",
              fileSize: 500000,
            },
          ],
        }),
      });

      // Mark upload as complete
      const response = await SELF.fetch(
        "http://example.com/api/sync/books/upload_test_123/upload-complete",
        {
          method: "POST",
          headers: {
            Cookie: testUser.sessionCookie,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ type: "epub" }),
        },
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.fileHash).toBe("upload_test_123");
      expect(data.type).toBe("epub");

      // Verify the book now has the R2 key
      const syncResponse = await SELF.fetch(
        "http://example.com/api/sync/books?since=0",
        {
          headers: {
            Cookie: testUser.sessionCookie,
          },
        },
      );

      const syncData = await syncResponse.json();
      const uploadedBook = syncData.books.find(
        (b: { fileHash: string }) => b.fileHash === "upload_test_123",
      );
      expect(uploadedBook).toBeDefined();
      expect(uploadedBook.epubR2Key).toBeDefined();
    });

    it("marks cover upload as complete", async () => {
      // Create a book first
      await SELF.fetch("http://example.com/api/sync/books", {
        method: "POST",
        headers: {
          Cookie: testUser.sessionCookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          books: [
            {
              fileHash: "cover_test_123",
              title: "Cover Test Book",
              author: "Cover Author",
              fileSize: 600000,
            },
          ],
        }),
      });

      // Mark cover upload as complete
      const response = await SELF.fetch(
        "http://example.com/api/sync/books/cover_test_123/upload-complete",
        {
          method: "POST",
          headers: {
            Cookie: testUser.sessionCookie,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ type: "cover" }),
        },
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.type).toBe("cover");
    });

    it("returns 400 for invalid upload type", async () => {
      const response = await SELF.fetch(
        "http://example.com/api/sync/books/some_hash/upload-complete",
        {
          method: "POST",
          headers: {
            Cookie: testUser.sessionCookie,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ type: "invalid" }),
        },
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      // zValidator wraps ZodError in { success: false, error: ZodError }
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
      expect(data.error.name).toBe("ZodError");
      expect(data.error.message).toBeDefined();
      expect(data.error.message.length).toBeGreaterThan(0);
    });

    it("returns 404 for non-existent book", async () => {
      const response = await SELF.fetch(
        "http://example.com/api/sync/books/nonexistent/upload-complete",
        {
          method: "POST",
          headers: {
            Cookie: testUser.sessionCookie,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ type: "epub" }),
        },
      );

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("Book not found");
    });
  });

  describe("Book restoration", () => {
    it("restores a soft-deleted book when pushed again", async () => {
      const fileHash = "restore_test_123";

      // Create a book
      await SELF.fetch("http://example.com/api/sync/books", {
        method: "POST",
        headers: {
          Cookie: testUser.sessionCookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          books: [
            {
              fileHash,
              title: "Book to Restore",
              author: "Restore Author",
              fileSize: 700000,
            },
          ],
        }),
      });

      // Delete the book
      await SELF.fetch(`http://example.com/api/sync/books/${fileHash}`, {
        method: "DELETE",
        headers: {
          Cookie: testUser.sessionCookie,
        },
      });

      // Verify it's deleted
      const syncAfterDelete = await SELF.fetch(
        "http://example.com/api/sync/books?since=0",
        {
          headers: {
            Cookie: testUser.sessionCookie,
          },
        },
      );
      const dataAfterDelete = await syncAfterDelete.json();
      const deletedBook = dataAfterDelete.books.find(
        (b: { fileHash: string }) => b.fileHash === fileHash,
      );
      expect(deletedBook.deletedAt).not.toBeNull();

      // Push the book again (should restore it)
      const restoreResponse = await SELF.fetch(
        "http://example.com/api/sync/books",
        {
          method: "POST",
          headers: {
            Cookie: testUser.sessionCookie,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            books: [
              {
                fileHash,
                title: "Book to Restore - Updated",
                author: "Restore Author",
                fileSize: 700000,
              },
            ],
          }),
        },
      );

      expect(restoreResponse.status).toBe(200);
      const restoreData = await restoreResponse.json();
      expect(restoreData.results[0].status).toBe("updated");

      // Verify it's restored
      const syncAfterRestore = await SELF.fetch(
        "http://example.com/api/sync/books?since=0",
        {
          headers: {
            Cookie: testUser.sessionCookie,
          },
        },
      );
      const dataAfterRestore = await syncAfterRestore.json();
      const restoredBook = dataAfterRestore.books.find(
        (b: { fileHash: string }) => b.fileHash === fileHash,
      );
      expect(restoredBook.deletedAt).toBeNull();
      expect(restoredBook.title).toBe("Book to Restore - Updated");
    });
  });
});
