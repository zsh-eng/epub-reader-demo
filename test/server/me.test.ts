import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestUser } from "./helpers";

describe("GET /api/me", () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>;

  beforeAll(async () => {
    testUser = await createTestUser(
      "metest@example.com",
      "testpassword123",
      "Me Test User",
    );
  });

  it("returns user data for authenticated requests", async () => {
    const response = await SELF.fetch("http://example.com/api/me", {
      headers: {
        Cookie: testUser.sessionCookie,
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const data = await response.json();
    expect(data.user).toBeDefined();
    expect(data.user.email).toBe(testUser.email);
    expect(data.user.name).toBe(testUser.name);
    expect(data.user.id).toBeDefined();
  });

  it("returns 401 for unauthenticated requests", async () => {
    const response = await SELF.fetch("http://example.com/api/me");

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");

    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 401 for requests with invalid session cookie", async () => {
    const response = await SELF.fetch("http://example.com/api/me", {
      headers: {
        Cookie: "better-auth.session_token=invalid-token-123",
      },
    });

    expect(response.status).toBe(401);

    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });
});
