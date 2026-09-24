import { expect, test, vi } from "vitest";
import type { BrowseRead } from "../../src/shared/browse";
import type { SymbolSearch } from "../../src/shared/symbols";
import type { BrowseApi } from "../../src/web/data/browse";
import { findDefinitions } from "../../src/web/data/definitions";

const file: BrowseRead = {
  source: { kind: "worktree", repo: "/repo/worktree" },
  path: "src/a.ts",
  identity: "bytes:1",
  kind: "text",
  size: 20,
  text: "function target() {}",
};
const match = { name: "target", kind: "function", path: file.path, line: 1 };
const local: SymbolSearch = {
  source: file.source,
  path: file.path,
  identity: file.identity,
  query: "target",
  engine: "ctags",
  matches: [match],
  truncated: false,
};
const signal = () => new AbortController().signal;
function apiWith(symbols: NonNullable<BrowseApi["symbols"]>): BrowseApi {
  return { symbols, list: vi.fn<BrowseApi["list"]>(), read: vi.fn<BrowseApi["read"]>() };
}
test("definition lookup prefers exact ctags declarations from the current file bytes", async () => {
  const symbols = vi.fn<NonNullable<BrowseApi["symbols"]>>(async () => ({
    ...local,
    matches: [match, { ...match, name: "targetOther" }],
  }));
  const result = await findDefinitions(apiWith(symbols), file, "target", signal());
  expect(result.matches).toEqual([match]);
  expect(symbols).toHaveBeenCalledTimes(1);
  expect(symbols.mock.calls[0]).toEqual([
    file.source,
    "target",
    { path: file.path, identity: file.identity },
    expect.any(AbortSignal),
  ]);
});
test("project definitions retain their indexed commit and all ambiguous candidates", async () => {
  const committed = { kind: "commit" as const, repo: file.source.repo, oid: "a".repeat(40) };
  const matches = [
    { ...match, path: "src/b.ts" },
    { ...match, path: "src/c.ts" },
  ];
  const symbols = vi
    .fn<NonNullable<BrowseApi["symbols"]>>()
    .mockResolvedValueOnce({ ...local, matches: [] })
    .mockResolvedValueOnce({
      ...local,
      path: undefined,
      resultSource: committed,
      matches,
      engine: "zoekt",
    });
  const result = await findDefinitions(apiWith(symbols), file, "target", signal());
  expect(result.resultSource).toEqual(committed);
  expect(result.matches).toEqual(matches);
});
test("a changed file or cancelled lookup cannot navigate to another snapshot", async () => {
  const symbols = vi.fn<NonNullable<BrowseApi["symbols"]>>(async () => ({
    ...local,
    identity: "bytes:2",
  }));
  await expect(findDefinitions(apiWith(symbols), file, "target", signal())).rejects.toThrow(
    "Refresh",
  );
  const abort = new AbortController();
  abort.abort();
  await expect(
    findDefinitions(
      apiWith(vi.fn<NonNullable<BrowseApi["symbols"]>>(async () => local)),
      file,
      "target",
      abort.signal,
    ),
  ).rejects.toThrow(/abort/i);
});
