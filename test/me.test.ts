import { SELF } from "cloudflare:test";
import { describe, expect, it, beforeAll } from "vitest";

describe("GET /api/me", () => {
  let sessionCookie: string;
  const testEmail = "metest@example.com";
  const testPassword = "testpassword123";
  const testName = "Me Test User";

  beforeAll(async () => {
    // Sign up a test user via Better Auth's API
    const signUpResponse = await SELF.fetch("http://example.com/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
        name: testName,
      }),
    });

    // Extract the session cookie from the response
    const setCookie = signUpResponse.headers.get("set-cookie");
    if (setCookie) {
      sessionCookie = setCookie.split(";")[0]; // e.g., "better-auth.session_token=..."
    }
  });

  it("returns user data for authenticated requests", async () => {
    const response = await SELF.fetch("http://example.com/api/me", {
      headers: {
        Cookie: sessionCookie,
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const data = await response.json();
    expect(data.user).toBeDefined();
    expect(data.user.email).toBe(testEmail);
    expect(data.user.name).toBe(testName);
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
