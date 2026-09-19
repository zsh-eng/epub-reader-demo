import { expect, test } from "vitest";
import type { BrowseRead } from "../../src/shared/browse";
import type { BrowseBlame } from "../../src/shared/inspect";
import { createBlameLoader } from "../../src/web/data/blame";

const file: BrowseRead = {
  source: { kind: "worktree", repo: "/fixture" },
  path: "src/example.ts",
  identity: "current:example:123",
  kind: "text",
  size: 12,
  text: "example();\n",
};
const attribution: BrowseBlame = {
  source: file.source,
  path: file.path,
  identity: file.identity,
  lines: [
    {
      line: 1,
      commit: "a".repeat(40),
      author: "Mira",
      date: "2026-09-19T12:00:00Z",
      summary: "Example",
    },
  ],
  truncated: false,
};

test.each([
  { source: { kind: "worktree", repo: "/another" } },
  { path: "other.ts" },
  { identity: "current:example:124" },
])("rejects attribution for a different source, path, or file version: %j", async (wrong) => {
  const loader = createBlameLoader(async () => Response.json({ ...attribution, ...wrong }), "");
  await expect(loader(file, 1, 1, new AbortController().signal)).rejects.toThrow(
    "different file version",
  );
});

test("rejects attribution outside the requested line range", async () => {
  const loader = createBlameLoader(async () => Response.json(attribution), "");
  await expect(loader(file, 2, 3, new AbortController().signal)).rejects.toThrow("selected lines");
});

test("passes cancellation and the rendered file identity to the authenticated request", async () => {
  const controller = new AbortController();
  const loader = createBlameLoader(async (_url, init) => {
    expect(init?.signal).toBe(controller.signal);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer session-key");
    expect(JSON.parse(init!.body as string)).toEqual({
      source: file.source,
      path: file.path,
      identity: file.identity,
      startLine: 1,
      endLine: 1,
    });
    return Response.json(attribution);
  }, "session-key");
  expect(await loader(file, 1, 1, controller.signal)).toEqual(attribution);
});
