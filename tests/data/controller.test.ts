import { describe, expect, test, vi } from "vitest";
import type { FileDiffMetadata } from "@pierre/diffs";
import type { Comparison, NoteState, ReviewResponse } from "../../src/shared/protocol";
import { createReviewController } from "../../src/web/data/controller";
import { parseReviewPatch } from "../../src/shared/review";

const A = "a".repeat(40);
const B = "b".repeat(40);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function response(comparison: Comparison, repo = "/repo"): ReviewResponse {
  const id = comparison.kind === "commit" ? comparison.commit : comparison.kind;
  return {
    id,
    repo,
    comparison,
    base: "base",
    head: id,
    label: id,
    patch: id,
    files: [{ path: "a.ts", status: "M", binary: false, additions: 1, deletions: 1 }],
    warnings: [],
    metrics: { gitMs: 1, totalMs: 2, patchBytes: id.length, cacheHit: false },
  };
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
function fixture(
  options: {
    review?: (comparison: Comparison, repo: string) => Promise<Response>;
    notes?: (id: string, init?: RequestInit) => Promise<Response>;
    source?: (id: string, path: string) => Promise<Response>;
    parse?: (patch: string) => Promise<FileDiffMetadata[]>;
    events?: () => ReadableStream<Uint8Array>;
    cacheBytes?: number;
    initialComparison?: Comparison;
    git?: boolean;
  } = {},
) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    calls.push({ url: `${url.pathname}${url.search}`, init });
    const repo = url.searchParams.get("repo") ?? "/repo";
    if (url.pathname === "/api/session")
      return json({
        protocol: 1,
        repository: {
          path: repo,
          name: "repo",
          head: A,
          branch: "main",
          shallow: false,
          git: options.git,
        },
        worktrees: options.git === false ? [] : [{ path: repo, head: A, branch: "main" }],
        initialComparison: options.initialComparison,
      });
    if (url.pathname === "/api/branches") return Response.json([]);
    if (url.pathname === "/api/history") return json({ commits: [], cursor: null, hasMore: false });
    if (url.pathname === "/api/events" && options.events)
      return new Response(options.events(), { headers: { "Content-Type": "text/event-stream" } });
    if (url.pathname === "/api/review") {
      const request = JSON.parse(String(init?.body)) as { comparison: Comparison; repo: string };
      return (
        options.review?.(request.comparison, request.repo) ??
        json(response(request.comparison, request.repo))
      );
    }
    if (url.pathname === "/api/notes") {
      const id =
        url.searchParams.get("reviewId") ??
        (JSON.parse(String(init?.body)) as { reviewId: string }).reviewId;
      return options.notes?.(id, init) ?? json({ reviewId: id, revision: 0, notes: [] });
    }
    if (url.pathname === "/api/source")
      return (
        options.source?.(url.searchParams.get("reviewId")!, url.searchParams.get("path")!) ??
        json({
          reviewId: url.searchParams.get("reviewId"),
          path: url.searchParams.get("path"),
          old: "old",
          new: "new",
        })
      );
    throw new Error(`Unexpected request: ${url}`);
  });
  const controller = createReviewController({
    token: "test-token",
    fetch: fetcher as typeof fetch,
    parsePatch: options.parse ?? (async () => []),
    events: Boolean(options.events),
    cacheBytes: options.cacheBytes,
  });
  return { controller, calls, fetcher };
}

describe("review request ownership", () => {
  test.each<Comparison>([
    { kind: "patch", path: "/inputs/review.patch" },
    { kind: "files", oldPath: "/inputs/before.ts", newPath: "/inputs/after.ts" },
  ])(
    "opens the declared non-Git input without requesting Git history: $kind",
    async (comparison) => {
      const { controller, calls } = fixture({ initialComparison: comparison, git: false });
      await controller.initialize();
      expect(controller.getSnapshot().comparison).toEqual(comparison);
      expect(controller.getSnapshot().review?.comparison).toEqual(comparison);
      expect(controller.getSnapshot().session?.repository.git).toBe(false);
      expect(controller.getSnapshot().historyHasMore).toBe(false);
      expect(controller.getSnapshot().status).toBe("ready");
      await controller.loadMoreHistory();
      await controller.refresh();
      expect(calls.filter((call) => call.url.startsWith("/api/history"))).toHaveLength(0);
      expect(calls.filter((call) => call.url === "/api/review")).toHaveLength(2);
      await controller.selectComparison(comparison);
      expect(calls.filter((call) => call.url === "/api/review")).toHaveLength(3);
      expect(controller.getSnapshot().metrics?.cacheHit).toBe(false);
      await controller.selectWorktree("/other");
      expect(calls.filter((call) => call.url.startsWith("/api/session"))).toHaveLength(1);
      expect(controller.getSnapshot().error).toContain("Worktrees are not available");
      await controller.selectComparison({ kind: "staged" });
      expect(calls.filter((call) => call.url === "/api/review")).toHaveLength(3);
      expect(controller.getSnapshot().error).toContain("Git comparisons are not available");
      controller.dispose();
    },
  );

  test("comparison identity ignores key order and omitted false flags, but keeps inclusive ranges distinct", async () => {
    const { controller, calls } = fixture();
    await controller.initialize();
    await controller.selectComparison({ head: B, kind: "range", base: A });
    expect(controller.getSnapshot().status).toBe("ready");
    const count = calls.length;
    await controller.selectComparison({ kind: "range", base: A, head: B, includeBase: false });
    expect(controller.getSnapshot().status).toBe("ready");
    expect(calls.filter((call) => call.url === "/api/review")).toHaveLength(2);
    expect(calls.length).toBeGreaterThanOrEqual(count);
    await controller.selectComparison({ kind: "range", base: A, head: B, includeBase: true });
    expect(controller.getSnapshot().review?.comparison).toEqual({
      kind: "range",
      base: A,
      head: B,
      includeBase: true,
    });
    expect(calls.filter((call) => call.url === "/api/review")).toHaveLength(3);
    controller.dispose();
  });

  test("an inclusive range cannot accept an exclusive response", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { controller } = fixture({
      review: async (comparison) =>
        json(
          response(
            comparison.kind === "range" ? { ...comparison, includeBase: false } : comparison,
          ),
        ),
    });
    try {
      await controller.initialize();
      await controller.selectComparison({ kind: "range", base: A, head: B, includeBase: true });
      expect(controller.getSnapshot().error).toContain("different comparison");
      expect(logged).toHaveBeenCalledWith(
        "Comparison response mismatch",
        expect.objectContaining({
          requested: expect.objectContaining({
            comparison: expect.objectContaining({ includeBase: true }),
          }),
        }),
      );
    } finally {
      controller.dispose();
      logged.mockRestore();
    }
  });

  test("respects a declared initial commit in a Git repository", async () => {
    const { controller, calls } = fixture({
      initialComparison: { kind: "commit", commit: A },
      git: true,
    });
    await controller.initialize();
    expect(controller.getSnapshot().review?.id).toBe(A);
    expect(calls.filter((call) => call.url.startsWith("/api/history"))).toHaveLength(1);
    expect(calls.filter((call) => call.url === "/api/review")).toHaveLength(1);
    controller.dispose();
  });

  test("rejects a late HTTP response after a newer commit was selected", async () => {
    const late = deferred<Response>();
    const { controller, calls } = fixture({
      review: async (comparison, repo) =>
        comparison.kind === "commit" && comparison.commit === A
          ? late.promise
          : json(response(comparison, repo)),
    });
    await controller.initialize();
    const pending = controller.selectComparison({ kind: "commit", commit: A });
    await controller.selectComparison({ kind: "commit", commit: B });
    late.resolve(json(response({ kind: "commit", commit: A })));
    await pending;
    expect(controller.getSnapshot().review?.id).toBe(B);
    expect(controller.getSnapshot().status).toBe("ready");
    expect(new Headers(calls[0]?.init?.headers).get("Authorization")).toBe("Bearer test-token");
    controller.dispose();
  });

  test("rejects a late worker parse result, even when the HTTP response already arrived", async () => {
    const late = deferred<FileDiffMetadata[]>();
    const parse = vi.fn<(patch: string) => Promise<FileDiffMetadata[]>>(async (patch: string) =>
      patch === A ? late.promise : [],
    );
    const { controller } = fixture({ parse });
    await controller.initialize();
    const pending = controller.selectComparison({ kind: "commit", commit: A });
    await vi.waitFor(() => expect(parse).toHaveBeenCalledWith(A));
    await controller.selectComparison({ kind: "commit", commit: B });
    late.resolve([]);
    await pending;
    expect(controller.getSnapshot().review?.id).toBe(B);
    controller.dispose();
  });

  test("uses the parsed immutable cache on A → B → A but never caches a branch name", async () => {
    const { controller, calls } = fixture();
    await controller.initialize();
    await controller.selectComparison({ kind: "commit", commit: A });
    await controller.selectComparison({ kind: "commit", commit: B });
    await controller.selectComparison({ kind: "commit", commit: A });
    expect(controller.getSnapshot().metrics?.cacheHit).toBe(true);
    expect(calls.filter((call) => call.url === "/api/review")).toHaveLength(3);
    await controller.selectComparison({ kind: "commit", commit: "main" });
    await controller.selectComparison({ kind: "commit", commit: "main" });
    expect(controller.getSnapshot().metrics?.cacheHit).toBe(false);
    expect(calls.filter((call) => call.url === "/api/review")).toHaveLength(5);
    controller.dispose();
  });

  test("does not retain a review beyond its byte budget", async () => {
    const { controller, calls } = fixture({ cacheBytes: 1 });
    await controller.initialize();
    await controller.selectComparison({ kind: "commit", commit: A });
    await controller.selectComparison({ kind: "commit", commit: B });
    await controller.selectComparison({ kind: "commit", commit: A });
    expect(calls.filter((call) => call.url === "/api/review")).toHaveLength(4);
    controller.dispose();
  });

  test("reselecting or refreshing the same review retains Pierre metadata identity", async () => {
    const { controller } = fixture({
      parse: async () =>
        parseReviewPatch(
          "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n",
        ),
    });
    await controller.initialize();
    await controller.selectComparison({ kind: "commit", commit: A });
    const before = controller.getSnapshot().files;
    expect(before[0].metadata).not.toBeNull();
    await controller.selectComparison({ kind: "commit", commit: A });
    expect(controller.getSnapshot().files).toBe(before);
    await controller.refresh();
    expect(controller.getSnapshot().files[0].metadata).toBe(before[0].metadata);
    await controller.selectComparison({ kind: "commit", commit: B });
    expect(controller.getSnapshot().files[0].metadata).not.toBe(before[0].metadata);
    controller.dispose();
  });

  test("renderer hydration cannot mutate the canonical byte-bounded commit cache", async () => {
    const patch = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n";
    const { controller, calls } = fixture({
      cacheBytes: 128 * 1024,
      parse: async () => parseReviewPatch(patch),
    });
    await controller.initialize();
    await controller.selectComparison({ kind: "commit", commit: A });
    const first = controller.getSnapshot().files[0]!.metadata!;
    expect(first.isPartial).toBe(true);
    // Model Pierre's in-place hydration, including a payload larger than the LRU budget.
    first.isPartial = false;
    first.additionLines.push("expanded context".repeat(64 * 1024));
    first.hunks[0]!.additionCount = 100_000;
    await controller.selectComparison({ kind: "commit", commit: B });
    await controller.selectComparison({ kind: "commit", commit: A });
    const returned = controller.getSnapshot().files[0]!.metadata!;
    expect(controller.getSnapshot().metrics?.cacheHit).toBe(true);
    expect(calls.filter((call) => call.url === "/api/review")).toHaveLength(3);
    expect(returned).not.toBe(first);
    expect(returned.additionLines).not.toBe(first.additionLines);
    expect(returned.hunks[0]).not.toBe(first.hunks[0]);
    expect(returned.isPartial).toBe(true);
    expect(returned.additionLines).toHaveLength(1);
    expect(returned.hunks[0]!.additionCount).toBe(1);
    controller.dispose();
  });

  test("a worktree switch rejects previous worktree data even with identical commit input", async () => {
    const late = deferred<Response>();
    const { controller } = fixture({
      review: async (comparison, repo) =>
        comparison.kind === "commit" && repo === "/repo"
          ? late.promise
          : json(response(comparison, repo)),
    });
    await controller.initialize();
    const pending = controller.selectComparison({ kind: "commit", commit: A });
    await controller.selectWorktree("/other");
    late.resolve(json(response({ kind: "commit", commit: A })));
    await pending;
    expect(controller.getSnapshot().review?.repo).toBe("/other");
    controller.dispose();
  });

  test("keeps the old view when loading fails and separates path filtering from file order", async () => {
    const { controller } = fixture({
      review: async (comparison, repo) =>
        comparison.kind === "commit"
          ? json({ error: { message: "Missing commit." } }, 404)
          : json(response(comparison, repo)),
    });
    await controller.initialize();
    controller.setFilter("missing");
    expect(controller.getSnapshot().files).toHaveLength(1);
    expect(controller.getSnapshot().visibleFiles).toHaveLength(0);
    controller.setFilter("A.TS");
    expect(controller.getSnapshot().visibleFiles).toHaveLength(1);
    await controller.selectComparison({ kind: "commit", commit: A });
    expect(controller.getSnapshot().review?.id).toBe("working");
    expect(controller.getSnapshot().error).toBe("Missing commit.");
    controller.dispose();
  });
});

describe("live event reconciliation", () => {
  test("refreshes history on changes but refetches only mutable comparisons", async () => {
    let writer!: ReadableStreamDefaultController<Uint8Array>;
    const { controller, calls } = fixture({
      events: () =>
        new ReadableStream({
          start(value) {
            writer = value;
          },
        }),
    });
    const send = (revision: number) =>
      writer.enqueue(
        new TextEncoder().encode(
          `data: ${JSON.stringify({ type: "changed", repo: "/repo", revision })}\n\n`,
        ),
      );
    await controller.initialize();
    await controller.selectComparison({ kind: "commit", commit: A });
    send(1);
    await vi.waitFor(() =>
      expect(calls.filter((call) => call.url.startsWith("/api/history"))).toHaveLength(2),
    );
    expect(calls.filter((call) => call.url === "/api/review")).toHaveLength(2);
    await controller.selectComparison({ kind: "working" });
    send(2);
    await vi.waitFor(() =>
      expect(calls.filter((call) => call.url === "/api/review")).toHaveLength(4),
    );
    const eventCall = calls.find((call) => call.url.startsWith("/api/events"));
    expect(new Headers(eventCall?.init?.headers).get("Authorization")).toBe("Bearer test-token");
    controller.dispose();
  });

  test("reconciles after reconnect even if the ready event repeats its revision", async () => {
    let connections = 0;
    let writer!: ReadableStreamDefaultController<Uint8Array>;
    const { controller, calls } = fixture({
      events: () =>
        new ReadableStream({
          start(value) {
            writer = value;
            connections += 1;
            value.enqueue(
              new TextEncoder().encode('data: {"type":"ready","repo":"/repo","revision":0}\n\n'),
            );
          },
        }),
    });
    await controller.initialize();
    await vi.waitFor(() => expect(controller.getSnapshot().connection).toBe("connected"));
    writer.close();
    await vi.waitFor(() => expect(connections).toBe(2), { timeout: 2000 });
    await vi.waitFor(() =>
      expect(calls.filter((call) => call.url.startsWith("/api/history"))).toHaveLength(2),
    );
    controller.dispose();
  });
});

describe("notes and source ownership", () => {
  test("a delayed notes GET cannot replace the newly selected review notes", async () => {
    const late = deferred<Response>();
    const { controller } = fixture({
      notes: async (id) =>
        id === A ? late.promise : json({ reviewId: id, revision: 0, notes: [] }),
    });
    await controller.initialize();
    await controller.selectComparison({ kind: "commit", commit: A });
    await controller.selectComparison({ kind: "commit", commit: B });
    await vi.waitFor(() => expect(controller.getSnapshot().notes?.reviewId).toBe(B));
    late.resolve(json({ reviewId: A, revision: 2, notes: [] }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(controller.getSnapshot().notes?.reviewId).toBe(B);
    controller.dispose();
  });

  test("a delayed notes POST cannot replace another review; requests use optimistic revision", async () => {
    const late = deferred<Response>();
    const { controller, calls } = fixture({
      notes: async (id, init) =>
        init?.method === "POST" ? late.promise : json({ reviewId: id, revision: 3, notes: [] }),
    });
    await controller.initialize();
    await vi.waitFor(() => expect(controller.getSnapshot().notes?.revision).toBe(3));
    const pending = controller.mutateNote({
      type: "add",
      note: { path: "a.ts", side: "new", line: 1, text: "Check" },
    });
    expect(
      JSON.parse(String(calls.find((call) => call.url === "/api/notes")?.init?.body))
        .expectedRevision,
    ).toBe(3);
    await controller.selectComparison({ kind: "commit", commit: B });
    late.resolve(json({ reviewId: "working", revision: 4, notes: [] }));
    await pending;
    await vi.waitFor(() => expect(controller.getSnapshot().notes?.reviewId).toBe(B));
    controller.dispose();
  });

  test("refreshes authoritative notes on revision conflict and reports the rejected write", async () => {
    let count = 0;
    const { controller } = fixture({
      notes: async (id, init) => {
        if (init?.method === "POST")
          return json({ error: { message: "Notes changed. Retry." } }, 409);
        return json({ reviewId: id, revision: count++, notes: [] } satisfies NoteState);
      },
    });
    await controller.initialize();
    await vi.waitFor(() => expect(controller.getSnapshot().notes?.revision).toBe(0));
    await expect(controller.mutateNote({ type: "remove", id: "deleted" })).rejects.toThrow(
      "Notes changed",
    );
    expect(controller.getSnapshot().notes?.revision).toBe(1);
    expect(controller.getSnapshot().notesError).toBe("Notes changed. Retry.");
    controller.dispose();
  });

  test("deduplicates source reads and rejects late source after commit selection", async () => {
    const late = deferred<Response>();
    const { controller, calls } = fixture({ source: async () => late.promise });
    await controller.initialize();
    const first = controller.loadSources("a.ts");
    const second = controller.loadSources("a.ts");
    const rejected = Promise.allSettled([first, second]);
    expect(calls.filter((call) => call.url.startsWith("/api/source"))).toHaveLength(1);
    await controller.selectComparison({ kind: "commit", commit: B });
    late.resolve(json({ reviewId: "working", path: "a.ts", old: "old", new: "new" }));
    expect((await rejected).map((result) => result.status)).toEqual(["rejected", "rejected"]);
    controller.dispose();
  });
});
