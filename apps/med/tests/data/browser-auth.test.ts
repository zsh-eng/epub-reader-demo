import { afterEach, expect, test, vi } from "vitest";
import { authorizeBrowser, readBrowserToken } from "../../src/web/data/auth";
afterEach(() => vi.unstubAllGlobals());
test("launch token authorizes new browser tabs and removes only the token from the URL", async () => {
  vi.stubGlobal("location", {
    hash: "#token=secret&other=value",
    pathname: "/review/saved",
    search: "?x=1",
  });
  const replaceState = vi.fn<History["replaceState"]>();
  vi.stubGlobal("history", { replaceState });
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ authenticated: true }));
  expect(readBrowserToken()).toBe("secret");
  await authorizeBrowser(fetcher);
  expect(fetcher).toHaveBeenCalledWith("/api/auth", {
    method: "POST",
    headers: { Authorization: "Bearer secret" },
  });
  expect(replaceState).toHaveBeenCalledWith(null, "", "/review/saved?x=1#other=value");
});
test("failed authorization retains the launch token and target route", async () => {
  vi.stubGlobal("location", { hash: "#token=secret", pathname: "/review/saved", search: "" });
  const replaceState = vi.fn<History["replaceState"]>();
  vi.stubGlobal("history", { replaceState });
  await authorizeBrowser(
    vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 })),
  );
  expect(replaceState).not.toHaveBeenCalled();
});
