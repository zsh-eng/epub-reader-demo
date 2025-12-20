import { SELF } from "cloudflare:test";

export interface TestUser {
  email: string;
  password: string;
  name: string;
  sessionCookie: string;
}

/**
 * Creates a test user via Better Auth's sign-up API and returns
 * the user credentials along with the session cookie.
 */
export async function createTestUser(
  email: string,
  password: string,
  name: string,
): Promise<TestUser> {
  const signUpResponse = await SELF.fetch(
    "http://example.com/api/auth/sign-up/email",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        name,
      }),
    },
  );

  if (!signUpResponse.ok) {
    throw new Error(`Failed to create test user: ${signUpResponse.status}`);
  }

  // Extract the session cookie from the response
  const setCookie = signUpResponse.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("No session cookie returned from sign-up");
  }

  const sessionCookie = setCookie.split(";")[0]; // e.g., "better-auth.session_token=..."

  return {
    email,
    password,
    name,
    sessionCookie,
  };
}
