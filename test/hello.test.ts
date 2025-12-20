import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("Hello endpoint", () => {
  it("responds with hello message from /api/hello", async () => {
    const response = await SELF.fetch("http://example.com/api/hello");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const data = await response.json();
    expect(data).toEqual({ message: "Hello from backend!" });
  });

  it("returns 404 for non-existent routes", async () => {
    const response = await SELF.fetch("http://example.com/api/nonexistent");

    expect(response.status).toBe(404);
  });
});
