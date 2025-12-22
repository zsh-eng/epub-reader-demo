import { env, SELF } from "cloudflare:test";

export interface TestUser {
  email: string;
  password: string;
  name: string;
  sessionCookie: string;
  userId: string;
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

  // Get the user ID
  const meResponse = await SELF.fetch("http://example.com/api/me", {
    headers: { Cookie: sessionCookie },
  });

  if (!meResponse.ok) {
    throw new Error(`Failed to get user ID: ${meResponse.status}`);
  }

  const meData = await meResponse.json();

  return {
    email,
    password,
    name,
    sessionCookie,
    userId: meData.user.id,
  };
}

/**
 * Uploads a test file to the R2 bucket.
 * Returns the R2 key where the file was stored.
 */
export async function uploadTestFile(
  r2Key: string,
  content: string | Uint8Array,
  contentType?: string,
): Promise<void> {
  const bucket = env.BOOK_STORAGE as R2Bucket;

  await bucket.put(r2Key, content, {
    httpMetadata: contentType ? { contentType } : undefined,
  });
}

/**
 * Creates a test EPUB file content (minimal valid EPUB structure)
 */
export function createTestEpubContent(): Uint8Array {
  // This is a minimal EPUB structure - just enough to be recognized as EPUB
  // In a real test, you might want to use a library to create proper EPUB
  const content = new TextEncoder().encode("Mock EPUB content");
  return content;
}

/**
 * Creates a test image file content
 */
export function createTestImageContent(): Uint8Array {
  // Minimal 1x1 PNG image
  const pngData = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
    0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  return pngData;
}
