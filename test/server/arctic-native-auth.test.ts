import { env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pkceChallenge } from "../../article-reader/SyncServer/native-auth";
import { createTestUser } from "./helpers";

const origin = "https://reader.zsheng.app";
const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const state = "s".repeat(43);
const prefix = `${origin}/api/arctic/auth`;

describe("native Google authorization handshake", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  beforeAll(async () => {
    user = await createTestUser(
      "native-oauth@example.com",
      "testpassword123",
      "Native OAuth",
    );
  });
  beforeEach(async () => {
    // Revocation tests intentionally destroy their session. Each case gets a new
    // real signed session, independent of the Worker test pool's storage mode.
    const signedIn = await SELF.fetch(`${origin}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ email: user.email, password: user.password }),
    });
    expect(signedIn.status).toBe(200);
    user.sessionCookie = signedIn.headers.get("set-cookie")!.split(";")[0]!;
  });
  async function start() {
    const response = await SELF.fetch(
      `${prefix}/start?state=${state}&challenge=${await pkceChallenge(verifier)}`,
      { redirect: "manual" },
    );
    expect(response.status).toBe(302);
    const google = new URL(response.headers.get("location")!);
    expect(google.origin).toBe("https://accounts.google.com");
    expect(google.searchParams.get("redirect_uri")).toBe(
      `${origin}/api/auth/callback/google`,
    );
    const cookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith("__Secure-arctic.auth_flow="))!
      .split(";")[0]!;
    const flow = cookie.split("=")[1]!;
    return { cookie, flow };
  }
  async function finish() {
    const { cookie, flow } = await start();
    // Google itself is not called: the existing Better Auth session is a local
    // fixture for its successfully authenticated browser callback.
    const response = await SELF.fetch(`${prefix}/finish?flow=${flow}`, {
      headers: { Cookie: `${cookie}; ${user.sessionCookie}` },
      redirect: "manual",
    });
    expect(response.status).toBe(302);
    const callback = new URL(response.headers.get("location")!);
    expect(callback.origin).toBe("null");
    expect(callback.protocol).toBe("articles:");
    expect(callback.hostname).toBe("auth");
    expect(callback.pathname).toBe("/callback");
    expect(callback.searchParams.get("state")).toBe(state);
    expect([...callback.searchParams.keys()].sort()).toEqual(["code", "state"]);
    return callback.searchParams.get("code")!;
  }
  function exchange(code: string, proof = verifier) {
    return SELF.fetch(`${prefix}/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, verifier: proof }),
    });
  }
  it("uses the existing Google callback and exchanges one code into an authenticated native session", async () => {
    const code = await finish();
    const stored = await env.ARCTIC_DATABASE.prepare(
      "SELECT payload FROM native_auth_codes WHERE code_hash = ?",
    )
      .bind(await pkceChallenge(code))
      .first<{ payload: string }>();
    expect(stored?.payload).not.toContain(user.email);
    expect(stored?.payload).not.toContain(user.sessionCookie.split("=")[1]);
    expect((await exchange(code, "w".repeat(43))).status).toBe(400);
    const response = await exchange(code);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      user: { id: user.userId, email: user.email },
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
    expect(
      (await SELF.fetch(`${origin}/api/me`, { headers: { Cookie: cookie } }))
        .status,
    ).toBe(200);
    expect((await exchange(code)).status).toBe(400);
  });
  it("allows only one simultaneous exchange", async () => {
    const code = await finish();
    const responses = await Promise.all([exchange(code), exchange(code)]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 400,
    ]);
  });
  it("requires the flow cookie and consumes the browser flow once", async () => {
    const { flow, cookie } = await start();
    expect(
      (
        await SELF.fetch(`${prefix}/finish?flow=${flow}`, {
          headers: { Cookie: user.sessionCookie },
          redirect: "manual",
        })
      ).status,
    ).toBe(400);
    const headers = { Cookie: `${cookie}; ${user.sessionCookie}` };
    expect(
      (
        await SELF.fetch(`${prefix}/finish?flow=${flow}`, {
          headers,
          redirect: "manual",
        })
      ).status,
    ).toBe(302);
    expect(
      (
        await SELF.fetch(`${prefix}/finish?flow=${flow}`, {
          headers,
          redirect: "manual",
        })
      ).status,
    ).toBe(400);
  });
  it("rejects expired codes and sessions revoked after browser completion", async () => {
    const expired = await finish();
    await env.ARCTIC_DATABASE.prepare(
      "UPDATE native_auth_codes SET expires_at = 0 WHERE code_hash = ?",
    )
      .bind(await pkceChallenge(expired))
      .run();
    expect((await exchange(expired)).status).toBe(400);
    const revoked = await finish();
    await SELF.fetch(`${origin}/api/auth/sign-out`, {
      method: "POST",
      headers: {
        Cookie: user.sessionCookie,
        "Content-Type": "application/json",
        Origin: origin,
      },
      body: "{}",
    });
    expect((await exchange(revoked)).status).toBe(401);
  });
  it("returns provider failures through the fixed callback without a credential", async () => {
    const { flow, cookie } = await start();
    const response = await SELF.fetch(`${prefix}/failure?flow=${flow}`, {
      headers: { Cookie: cookie },
      redirect: "manual",
    });
    const callback = new URL(response.headers.get("location")!);
    expect(callback.searchParams.get("state")).toBe(state);
    expect(callback.searchParams.get("error")).toBe("sign_in_failed");
    expect(callback.searchParams.has("code")).toBe(false);
  });
  it("rejects cross-site form login without consuming the native code", async () => {
    const code = await finish();
    const body = JSON.stringify({ code, verifier });
    const crossSite = await SELF.fetch(`${prefix}/exchange`, {
      method: "POST",
      headers: {
        Origin: "https://attacker.example",
        "Content-Type": "text/plain",
      },
      body,
    });
    expect(crossSite.status).toBe(403);
    expect(crossSite.headers.has("set-cookie")).toBe(false);
    const crossSiteJSON = await SELF.fetch(`${prefix}/exchange`, {
      method: "POST",
      headers: {
        Origin: "https://attacker.example",
        "Content-Type": "application/json",
      },
      body,
    });
    expect(crossSiteJSON.status).toBe(403);
    const plain = await SELF.fetch(`${prefix}/exchange`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body,
    });
    expect(plain.status).toBe(415);
    expect((await exchange(code)).status).toBe(200);
  });
  it("rejects a ciphertext transplanted into another authorization code", async () => {
    const victimCode = await finish();
    const controlledCode = await finish();
    const victim = await env.ARCTIC_DATABASE.prepare(
      "SELECT payload FROM native_auth_codes WHERE code_hash = ?",
    )
      .bind(await pkceChallenge(victimCode))
      .first<{ payload: string }>();
    await env.ARCTIC_DATABASE.prepare(
      "UPDATE native_auth_codes SET payload = ? WHERE code_hash = ?",
    )
      .bind(victim!.payload, await pkceChallenge(controlledCode))
      .run();
    expect((await exchange(controlledCode)).status).toBe(400);
  });
  it("rejects a stored PKCE challenge changed to an attacker's verifier", async () => {
    const code = await finish();
    const attackerVerifier = "a".repeat(43);
    await env.ARCTIC_DATABASE.prepare(
      "UPDATE native_auth_codes SET challenge = ? WHERE code_hash = ?",
    )
      .bind(await pkceChallenge(attackerVerifier), await pkceChallenge(code))
      .run();
    expect((await exchange(code, attackerVerifier)).status).toBe(400);
  });
  it("rejects a stored expiry that was extended after code issuance", async () => {
    const code = await finish();
    await env.ARCTIC_DATABASE.prepare(
      "UPDATE native_auth_codes SET expires_at = expires_at + 3600000 WHERE code_hash = ?",
    )
      .bind(await pkceChallenge(code))
      .run();
    expect((await exchange(code)).status).toBe(400);
  });
  it("rejects malformed requests before storing a handshake", async () => {
    expect(
      (await SELF.fetch(`${prefix}/start?state=short&challenge=short`)).status,
    ).toBe(400);
    expect((await exchange("short")).status).toBe(400);
    for (const body of ["null", "[]", "{", "{}"]) {
      const response = await SELF.fetch(`${prefix}/exchange`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      expect(response.status).toBe(400);
    }
    expect(
      await env.ARCTIC_DATABASE.prepare(
        "SELECT count(*) AS count FROM native_auth_flows",
      ).first(),
    ).toEqual({ count: 0 });
  });
});
