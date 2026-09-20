import { describe, expect, test, vi } from "vitest";
import { createFileWorkspace } from "../../src/web/data/file-workspace";
import type { BrowseApi } from "../../src/web/data/browse";
import type { BrowseRead, BrowseSource } from "../../src/shared/browse";
const A: BrowseSource = { kind: "worktree", repo: "/first" };
const B: BrowseSource = { kind: "worktree", repo: "/second" };
function result(source: BrowseSource, path: string, kind: BrowseRead["kind"] = "text"): BrowseRead {
  return {
    source,
    path,
    kind,
    size: 12,
    identity: `${source.repo}:${path}`,
    ...(kind === "text" ? { text: source.repo } : {}),
  };
}
function fixture() {
  const pending: {
    source: BrowseSource;
    path: string;
    signal?: AbortSignal;
    resolve(value: BrowseRead): void;
    reject(error: Error): void;
  }[] = [];
  const api: BrowseApi = {
    list: vi.fn<BrowseApi["list"]>(),
    read: (source, path, signal) =>
      new Promise((resolve, reject) => pending.push({ source, path, signal, resolve, reject })),
  };
  return { workspace: createFileWorkspace(api), pending };
}
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("file workspace", () => {
  test("symbol jumps retain their exact source and column, then clear column for a line-only jump", () => {
    const { workspace } = fixture();
    const commit: BrowseSource = { kind: "commit", repo: A.repo, oid: "a".repeat(40) };
    workspace.configure("first", A, "First");
    workspace.open("same.ts", true, 12, commit, "Commit aaaaaaaa", 9);
    expect(workspace.getSnapshot().tabs[0]).toMatchObject({ source: commit, line: 12, column: 9 });
    workspace.open("same.ts", false, 18, commit);
    expect(workspace.getSnapshot().tabs[0]).toMatchObject({ line: 18, column: undefined });
    workspace.dispose();
  });
  test("close others and close all affect only the current workspace and retain recent paths", async () => {
    const { workspace, pending } = fixture();
    workspace.configure("first", A, "First");
    workspace.open("one.ts", true);
    workspace.open("two.ts", true);
    const active = workspace.getSnapshot().active;
    workspace.closeOthers();
    expect(workspace.getSnapshot().tabs.map((tab) => tab.id)).toEqual([active]);
    expect(workspace.getSnapshot().recentPaths).toEqual(["two.ts", "one.ts"]);
    workspace.configure("second", B, "Second");
    expect(workspace.getSnapshot().recentPaths).toEqual([]);
    workspace.open("other.ts", true);
    workspace.closeAll();
    expect(pending.at(-1)?.signal?.aborted).toBe(true);
    pending.at(-1)!.resolve(result(B, "other.ts"));
    await settle();
    expect(workspace.getSnapshot().file).toBeNull();
    expect(workspace.getSnapshot().tabs).toEqual([]);
    workspace.configure("first", A, "First");
    expect(workspace.getSnapshot().tabs.map((tab) => tab.id)).toEqual([active]);
    expect(workspace.getSnapshot().recentPaths).toEqual(["two.ts", "one.ts"]);
    workspace.dispose();
  });
  test("reuses one preview, retains pinned tabs and returns to changes after closing", () => {
    const { workspace } = fixture();
    workspace.configure("first", A, "First");
    workspace.open("one.ts");
    workspace.open("two.ts");
    expect(workspace.getSnapshot().tabs.map((tab) => tab.path)).toEqual(["two.ts"]);
    workspace.pin(workspace.getSnapshot().active);
    workspace.open("three.ts");
    workspace.open("four.ts", true);
    expect(workspace.getSnapshot().tabs.map((tab) => [tab.path, tab.pinned])).toEqual([
      ["two.ts", true],
      ["four.ts", true],
    ]);
    workspace.open("two.ts", false, 12);
    expect(workspace.getSnapshot().tabs).toHaveLength(2);
    expect(workspace.getSnapshot().tabs[0]!.line).toBe(12);
    workspace.close(workspace.getSnapshot().active);
    expect(workspace.getSnapshot().active).toBe("changes");
    expect(workspace.getSnapshot().file).toBeNull();
    workspace.dispose();
  });
  test("restores tabs by worktree and rejects late bytes from the previous scope", async () => {
    const { workspace, pending } = fixture();
    workspace.configure("first", A, "First");
    workspace.open("same.ts", true);
    workspace.configure("second", B, "Second");
    workspace.open("same.ts");
    expect(pending[0]!.signal!.aborted).toBe(true);
    pending[1]!.resolve(result(B, "same.ts", "binary"));
    await settle();
    expect(workspace.getSnapshot().file?.kind).toBe("binary");
    expect(workspace.getSnapshot().file?.identity).toBe("/second:same.ts");
    pending[0]!.resolve(result(A, "same.ts"));
    await settle();
    expect(workspace.getSnapshot().file?.source.repo).toBe("/second");
    workspace.configure("first", A, "First");
    expect(workspace.getSnapshot().tabs[0]!.pinned).toBe(true);
    expect(workspace.getSnapshot().tabs[0]!.source.repo).toBe("/first");
    expect(workspace.getSnapshot().file).toBeNull();
    pending[2]!.resolve(result(A, "same.ts"));
    await settle();
    expect(workspace.getSnapshot().file?.text).toBe("/first");
    workspace.dispose();
  });
  test("accepts equivalent source field order but rejects a different source or path", async () => {
    const { workspace, pending } = fixture();
    workspace.configure("first", A, "First");
    workspace.open("same.ts");
    pending[0]!.resolve(result({ repo: "/first", kind: "worktree" }, "same.ts"));
    await settle();
    expect(workspace.getSnapshot().error).toBeNull();
    expect(workspace.getSnapshot().file?.path).toBe("same.ts");
    workspace.open("next.ts");
    pending[1]!.resolve(result(B, "next.ts", "missing"));
    await settle();
    expect(workspace.getSnapshot().error).toContain("does not match");
    expect(workspace.getSnapshot().file).toBeNull();
    workspace.open("next.ts");
    pending[2]!.resolve(result(A, "wrong.ts"));
    await settle();
    expect(workspace.getSnapshot().error).toContain("does not match");
    workspace.dispose();
  });
  test("bounds retained tabs and workspace history", () => {
    const { workspace } = fixture();
    workspace.configure("first", A, "First");
    for (let i = 0; i < 13; i++) workspace.open(`${i}.ts`, true);
    expect(workspace.getSnapshot().tabs).toHaveLength(12);
    expect(workspace.getSnapshot().error).toContain("12-tab limit");
    for (let i = 0; i < 8; i++)
      workspace.configure(`workspace-${i}`, { kind: "worktree", repo: `/repo-${i}` }, "Other");
    workspace.configure("first", A, "First");
    expect(workspace.getSnapshot().tabs).toHaveLength(0);
    expect(workspace.getSnapshot().active).toBe("changes");
    workspace.dispose();
  });
  test("invalidation marks loaded working files stale without fetching or changing commit snapshots", async () => {
    const { workspace, pending } = fixture();
    workspace.configure("first", A, "First");
    workspace.open("a.ts");
    pending[0]!.resolve(result(A, "a.ts"));
    await settle();
    workspace.invalidate();
    expect(workspace.getSnapshot().stale).toBe(true);
    expect(pending).toHaveLength(1);
    void workspace.refresh();
    expect(workspace.getSnapshot().stale).toBe(false);
    pending[1]!.resolve(result(A, "a.ts"));
    await settle();
    const commit: BrowseSource = { kind: "commit", repo: "/first", oid: "a".repeat(40) };
    workspace.open("a.ts", true, undefined, commit, "Commit");
    pending[2]!.resolve(result(commit, "a.ts"));
    await settle();
    workspace.invalidate();
    expect(workspace.getSnapshot().stale).toBe(false);
    workspace.dispose();
  });
  test("selecting Changes and disposal cancel reads and prevent stale errors", async () => {
    const { workspace, pending } = fixture();
    workspace.configure("first", A, "First");
    workspace.open("a.ts");
    workspace.select("changes");
    pending[0]!.reject(new Error("Late read failure"));
    await settle();
    expect(workspace.getSnapshot().error).toBeNull();
    expect(workspace.getSnapshot().loading).toBe(false);
    workspace.open("b.ts");
    const before = workspace.getSnapshot();
    workspace.dispose();
    expect(pending[1]!.signal!.aborted).toBe(true);
    pending[1]!.resolve(result(A, "b.ts"));
    await settle();
    expect(workspace.getSnapshot()).toBe(before);
  });
});
