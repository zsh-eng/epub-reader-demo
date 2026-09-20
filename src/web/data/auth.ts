export function readBrowserToken(): string {
  if (typeof location === "undefined") return "";
  return new URLSearchParams(location.hash.slice(1)).get("token") ?? "";
}

/** Exchange the launch token for a same-origin cookie usable by new review tabs. */
export async function authorizeBrowser(fetcher: typeof fetch = fetch): Promise<void> {
  const token = new URLSearchParams(location.hash.slice(1)).get("token");
  if (!token) return;
  const response = await fetcher("/api/auth", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return;
  const fragment = new URLSearchParams(location.hash.slice(1));
  fragment.delete("token");
  history.replaceState(
    null,
    "",
    `${location.pathname}${location.search}${fragment.size ? `#${fragment}` : ""}`,
  );
}
