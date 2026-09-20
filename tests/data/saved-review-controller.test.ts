import { describe, expect, test, vi } from "vitest";
import { createReviewController } from "../../src/web/data/controller";
import type { SavedReview } from "../../src/shared/saved-review";
import type { ReviewResponse } from "../../src/shared/protocol";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
function fixture({
  missing = false,
  unauthorized = false,
  intercept,
}: {
  missing?: boolean;
  unauthorized?: boolean;
  intercept?: (url: URL, init?: RequestInit) => Promise<Response | undefined>;
} = {}) {
  const calls: { path: string; body: unknown }[] = [];
  const targets = [
    {
      id: "t1",
      repositoryId: "r1",
      repo: "/one",
      branch: "main",
      label: "First range",
      comparison: { kind: "range" as const, base: A, head: B },
      base: A,
      head: B,
      captured: false,
    },
    {
      id: "t2",
      repositoryId: "r1",
      repo: "/one",
      branch: "main",
      label: "Second range",
      comparison: { kind: "range" as const, base: B, head: C },
      base: B,
      head: C,
      captured: false,
    },
    {
      id: "t3",
      repositoryId: "r2",
      repo: "/two",
      branch: "main",
      label: "Working changes",
      comparison: { kind: "working" as const },
      base: C,
      head: "captured",
      captured: true,
    },
  ];
  let saved: SavedReview = {
    id: "saved",
    title: "Agent changes",
    createdAt: "2026-09-20T00:00:00Z",
    revision: 4,
    commentCount: 3,
    targets,
  };
  const repositories = missing
    ? []
    : ["/one", "/two"].map((repo, index) => ({
        id: `r${index + 1}`,
        path: repo,
        name: repo.slice(1),
        branches: [{ name: "main", head: C, worktreePath: repo, current: true }],
        worktrees: [{ path: repo, head: C, branch: "main" }],
      }));
  const review = (index: number): ReviewResponse => ({
    id: `review-${targets[index].id}`,
    repo: targets[index].repo,
    comparison: targets[index].comparison,
    base: targets[index].base,
    head: targets[index].head,
    label: targets[index].label,
    files: [{ path: "file.ts", status: "M", additions: 1, deletions: 1, binary: false }],
    patch: "",
    warnings: [],
    metrics: { gitMs: 0, totalMs: 0, patchBytes: 0, cacheHit: false },
  });
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input), "http://localhost");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path: url.pathname, body });
    const intercepted = await intercept?.(url, init);
    if (intercepted) return intercepted;
    if (unauthorized) return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
    if (url.pathname === "/api/reviews/saved") return Response.json(saved);
    if (url.pathname === "/api/repositories") return Response.json({ repositories });
    if (url.pathname === "/api/session") {
      const repo = url.searchParams.get("repo") ?? "/one";
      const entry = repositories.find((entry) => entry.path === repo)!;
      return Response.json({
        protocol: 1,
        repositoryId: entry.id,
        repositories,
        repository: { path: repo, name: repo.slice(1), head: C, branch: "main", shallow: false },
        worktrees: entry.worktrees,
      });
    }
    if (url.pathname === "/api/history")
      return Response.json({ commits: [], cursor: null, hasMore: false });
    if (url.pathname === "/api/branches")
      return Response.json(
        repositories.find((entry) => entry.path === url.searchParams.get("repo"))!.branches,
      );
    const match = /^\/api\/reviews\/saved\/targets\/t([123])\/(review|notes|source)$/.exec(
      url.pathname,
    );
    if (match) {
      const index = Number(match[1]) - 1;
      if (match[2] === "review") return Response.json(review(index));
      if (match[2] === "source")
        return Response.json({
          reviewId: review(index).id,
          path: url.searchParams.get("path"),
          old: "before",
          new: "after",
        });
      if (init?.method === "POST")
        saved = { ...saved, revision: saved.revision + 1, commentCount: saved.commentCount + 1 };
      return Response.json({ reviewId: review(index).id, revision: saved.revision, notes: [] });
    }
    if (url.pathname === "/api/reviews/saved/feedback")
      return Response.json({
        text: "Feedback from one and two",
        count: saved.commentCount,
        repositoryCount: 2,
        revision: saved.revision,
      });
    if (url.pathname === "/api/reviews/saved/clear") {
      if (body.expectedRevision !== saved.revision)
        return Response.json(
          { error: { message: "Comments changed. Reload and try again." } },
          { status: 409 },
        );
      saved = { ...saved, revision: saved.revision + 1, commentCount: 0 };
      return Response.json(saved);
    }
    if (url.pathname === "/api/review")
      return Response.json({ ...review(0), id: "live", comparison: body.comparison });
    if (url.pathname === "/api/notes")
      return Response.json({ reviewId: "live", revision: 0, notes: [] });
    throw new Error(`Unexpected request ${url}`);
  });
  const controller = createReviewController({
    savedReviewId: "saved",
    fetch: fetcher,
    events: false,
    parsePatch: async () => [],
  });
  return {
    controller,
    calls,
    repositories,
    targets,
    updateSaved: (patch: Partial<SavedReview>) => {
      saved = { ...saved, ...patch };
    },
  };
}

describe("saved review navigation", () => {
  test("loads only the first target and keeps same-branch ranges separate", async () => {
    const { controller, calls } = fixture();
    await controller.initialize();
    expect(controller.getSnapshot().review?.id).toBe("review-t1");
    expect(calls.some((call) => call.path === "/api/review")).toBe(false);
    expect(calls.filter((call) => call.path.endsWith("/review"))).toHaveLength(1);
    await controller.selectSavedTarget("t2");
    expect(controller.getSnapshot().review?.base).toBe(B);
    expect(controller.getSnapshot().activeBranch).toBe("main");
    await controller.selectSavedTarget("t3");
    expect(controller.getSnapshot().activeRepositoryId).toBe("r2");
    expect(controller.getSnapshot().review?.head).toBe("captured");
    await controller.refresh();
    expect(calls.some((call) => call.path === "/api/review")).toBe(false);
    controller.dispose();
  });

  test("routes source and notes to saved target and returns after exploring history", async () => {
    const { controller, calls } = fixture();
    await controller.initialize();
    await vi.waitFor(() => expect(controller.getSnapshot().notes).not.toBeNull());
    const source = await controller.loadSources("file.ts");
    expect(source.new).toBe("after");
    await controller.mutateNote({
      type: "add",
      note: { path: "file.ts", side: "new", line: 1, text: "Fix this" },
    });
    expect(controller.getSnapshot().savedReview?.commentCount).toBe(4);
    await controller.selectComparison({ kind: "commit", commit: C });
    expect(controller.getSnapshot().savedView).toBe(false);
    await controller.returnToSavedReview();
    expect(controller.getSnapshot().review?.id).toBe("review-t1");
    expect(calls.some((call) => call.path === "/api/reviews/saved/targets/t1/source")).toBe(true);
    controller.dispose();
  });

  test("copies all target feedback and clears only this saved review at the expected revision", async () => {
    const { controller, calls } = fixture();
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    try {
      await controller.initialize();
      expect(await controller.copyFeedback()).toMatchObject({ count: 3, repositoryCount: 2 });
      expect(writeText).toHaveBeenCalledWith("Feedback from one and two");
      await expect(controller.clearSavedComments(3)).rejects.toThrow("Comments changed");
      expect(controller.getSnapshot().savedReview?.commentCount).toBe(3);
      await controller.clearSavedComments(4);
      expect(controller.getSnapshot().savedReview?.commentCount).toBe(0);
      expect(calls.filter((call) => call.path.endsWith("/clear")).map((call) => call.body)).toEqual(
        [{ expectedRevision: 3 }, { expectedRevision: 4 }],
      );
    } finally {
      controller.dispose();
      vi.unstubAllGlobals();
    }
  });

  test("does not fall back to another repository when the target is missing", async () => {
    const { controller, calls } = fixture({ missing: true });
    await controller.initialize();
    expect(controller.getSnapshot().status).toBe("error");
    expect(controller.getSnapshot().error).toContain("Repository unavailable: /one");
    expect(calls.some((call) => call.path === "/api/review")).toBe(false);
    controller.dispose();
  });

  test("explains browser authorization without changing the requested review", async () => {
    const { controller } = fixture({ unauthorized: true });
    await controller.initialize();
    expect(controller.getSnapshot().error).toContain("Open the launch link shown by med");
    controller.dispose();
  });
  test("registering a missing family restores the saved target instead of opening live changes", async () => {
    const { controller, calls, repositories } = fixture({ missing: true });
    await controller.initialize();
    repositories.push({
      id: "r1",
      path: "/one",
      name: "one",
      branches: [{ name: "main", head: C, worktreePath: "/one", current: true }],
      worktrees: [{ path: "/one", head: C, branch: "main" }],
    });
    await controller.addRepository("/one");
    expect(controller.getSnapshot().review?.id).toBe("review-t1");
    expect(controller.getSnapshot().savedView).toBe(true);
    expect(calls.some((call) => call.path === "/api/review")).toBe(false);
    controller.dispose();
  });

  test("a removed worktree uses the surviving checkout while keeping the original frozen source", async () => {
    const { controller, targets } = fixture();
    targets[0].repo = "/deleted-worktree";
    await controller.initialize();
    expect(controller.getSnapshot().session?.repository.path).toBe("/one");
    expect(controller.getSnapshot().review?.repo).toBe("/deleted-worktree");
    expect((await controller.loadSources("file.ts")).reviewId).toBe("review-t1");
    controller.dispose();
  });

  test("clear reloads notes on a target selected while the clear request was pending", async () => {
    let release!: () => void;
    let clearStarted = false;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { controller } = fixture({
      intercept: async (url) => {
        if (url.pathname.endsWith("/clear")) {
          clearStarted = true;
          await held;
        }
        return undefined;
      },
    });
    await controller.initialize();
    const clearing = controller.clearSavedComments(4);
    await vi.waitFor(() => expect(clearStarted).toBe(true));
    await controller.selectSavedTarget("t2");
    await vi.waitFor(() => expect(controller.getSnapshot().notes?.revision).toBe(4));
    release();
    await clearing;
    expect(controller.getSnapshot().notes?.reviewId).toBe("review-t2");
    expect(controller.getSnapshot().notes?.revision).toBe(5);
    expect(controller.getSnapshot().savedReview?.commentCount).toBe(0);
    controller.dispose();
  });

  test("returning to the browser refreshes comments written in another tab", async () => {
    const windowEvents = new EventTarget();
    vi.stubGlobal("window", windowEvents);
    vi.stubGlobal("document", new EventTarget());
    const { controller, updateSaved } = fixture();
    try {
      await controller.initialize();
      updateSaved({ revision: 5, commentCount: 8 });
      windowEvents.dispatchEvent(new Event("focus"));
      await vi.waitFor(() => expect(controller.getSnapshot().savedReview?.commentCount).toBe(8));
      await vi.waitFor(() => expect(controller.getSnapshot().notes?.revision).toBe(5));
    } finally {
      controller.dispose();
      vi.unstubAllGlobals();
    }
  });

  test("a saved note remains successful when the subsequent count refresh fails", async () => {
    let failMetadata = false;
    const { controller } = fixture({
      intercept: async (url) =>
        failMetadata && url.pathname === "/api/reviews/saved"
          ? Response.json({ error: { message: "Temporary metadata failure" } }, { status: 503 })
          : undefined,
    });
    await controller.initialize();
    await vi.waitFor(() => expect(controller.getSnapshot().notes).not.toBeNull());
    failMetadata = true;
    await controller.mutateNote({
      type: "add",
      note: { path: "file.ts", side: "new", line: 1, text: "Fix" },
    });
    expect(controller.getSnapshot().notes?.revision).toBe(5);
    expect(controller.getSnapshot().notesError).toBeNull();
    controller.dispose();
  });
  test("a worktree deleted after discovery falls back without replacing the saved comparison", async () => {
    const { controller, targets, repositories } = fixture({
      intercept: async (url) =>
        url.pathname === "/api/session" && url.searchParams.get("repo") === "/gone"
          ? Response.json({ error: { message: "Worktree unavailable" } }, { status: 403 })
          : undefined,
    });
    targets[0].repo = "/gone";
    repositories[0].worktrees.push({ path: "/gone", head: C, branch: "main" });
    await controller.initialize();
    expect(controller.getSnapshot().session?.repository.path).toBe("/one");
    expect(controller.getSnapshot().review?.repo).toBe("/gone");
    expect(controller.getSnapshot().savedView).toBe(true);
    expect(controller.getSnapshot().status).toBe("ready");
    controller.dispose();
  });
});
