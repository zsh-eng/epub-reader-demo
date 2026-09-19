import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WorkerPoolContextProvider, useWorkerPool } from "@pierre/diffs/react";
import PierreWorker from "@pierre/diffs/worker/worker.js?worker";
import type { BrowseRead } from "../../src/shared/browse";
import type { BrowseBlame } from "../../src/shared/inspect";
import type { BlameLoader } from "../../src/web/data/blame";
import { FullFileView } from "../../src/web/components/FullFileView";
import { FileViewTabs } from "../../src/web/components/FileViewTabs";
import { initializeTheme } from "../../src/web/themes";

let root: Root | undefined;
let mount: HTMLDivElement | undefined;
afterEach(() => {
  root?.unmount();
  mount?.remove();
  root = undefined;
  mount = undefined;
  vi.restoreAllMocks();
});
function render(element: React.ReactNode) {
  initializeTheme();
  mount = document.createElement("div");
  mount.style.cssText = "height:420px;width:900px;display:flex;flex-direction:column";
  document.body.append(mount);
  root = createRoot(mount);
  root.render(element);
}
const base: BrowseRead = {
  source: { kind: "worktree", repo: "/fixture" },
  path: "src/example.ts",
  kind: "text",
  size: 30,
  identity: "example:1",
  text: "export const example = true;\n",
};
const noop = () => {};
const props = { loading: false, error: null, sourceLabel: "feature/review", onRefresh: noop };
function lines() {
  return document.querySelector("diffs-container")?.shadowRoot?.querySelectorAll("[data-line]");
}

test("binary, missing and too-large responses never mount a code renderer", async () => {
  render(<FullFileView {...props} file={{ ...base, kind: "binary", text: "DO NOT RENDER" }} />);
  await expect
    .element(page.getByText("Binary file — content preview is not available."))
    .toBeVisible();
  expect(document.querySelector("diffs-container")).toBeNull();
  expect(mount!.textContent).not.toContain("DO NOT RENDER");
  let before = 0;
  root!.render(
    <FullFileView {...props} file={{ ...base, kind: "missing" }} onOpenBefore={() => before++} />,
  );
  await expect.element(page.getByText("This file does not exist in this worktree.")).toBeVisible();
  await page.getByRole("button", { name: "Open before" }).click();
  expect(before).toBe(1);
  expect(document.querySelector("diffs-container")).toBeNull();
  root!.render(<FullFileView {...props} file={{ ...base, kind: "too-large", size: 90_000_000 }} />);
  await expect.element(page.getByText("This file exceeds the preview size limit.")).toBeVisible();
  expect(document.querySelector("diffs-container")).toBeNull();
});

test("large plain files remain virtualized and never enter worker syntax highlighting", async () => {
  const large: BrowseRead = {
    ...base,
    plain: true,
    size: 2_000_000,
    identity: "large:1",
    text: Array.from({ length: 40000 }, (_, i) => `export const value${i} = ${i};\n`).join(""),
  };
  let pool: ReturnType<typeof useWorkerPool>;
  let highlight: ReturnType<typeof vi.spyOn> | undefined;
  function Probe() {
    const current = useWorkerPool();
    const [ready, setReady] = useState(false);
    useEffect(() => {
      pool = current;
      if (current) highlight = vi.spyOn(current, "highlightFileAST");
      let disposed = false;
      void current?.initialize().then(() => {
        if (!disposed) setReady(true);
      });
      return () => {
        disposed = true;
      };
    }, [current]);
    return ready ? <FullFileView {...props} file={large} line={39000} /> : null;
  }
  render(
    <WorkerPoolContextProvider
      poolOptions={{ workerFactory: () => new PierreWorker(), poolSize: 1 }}
      highlighterOptions={{ theme: "med-graphite-dark" }}
    >
      <Probe />
    </WorkerPoolContextProvider>,
  );
  await expect.poll(() => lines()?.length ?? 0).toBeGreaterThan(0);
  await expect.poll(() => pool?.isInitialized()).toBe(true);
  expect(lines()!.length).toBeLessThan(300);
  expect(highlight).not.toHaveBeenCalled();
  await expect
    .poll(() => document.querySelector("diffs-container")?.shadowRoot?.textContent)
    .toContain("value38999");
  expect(lines()!.length).toBeLessThan(300);
});

test("a long plain line uses horizontal scrolling instead of wrapping", async () => {
  render(
    <FullFileView
      {...props}
      file={{ ...base, identity: "long:1", plain: true, text: "x".repeat(250000), size: 250000 }}
    />,
  );
  await expect.poll(() => lines()?.length ?? 0).toBeGreaterThan(0);
  const shadow = document.querySelector("diffs-container")!.shadowRoot!;
  expect(shadow.querySelector("[data-overflow]")?.getAttribute("data-overflow")).toBe("scroll");
  expect(lines()!.length).toBeLessThan(3);
  expect(mount!.querySelector('[role="status"]')?.textContent).toContain("Plain text preview");
});

test("native wheel input scrolls a full file and restored previews stay scrollable", async () => {
  const file = {
    ...base,
    identity: "scroll:1",
    plain: true,
    text: Array.from({ length: 2000 }, (_, i) => `line ${i + 1}\n`).join(""),
  };
  let position = 0;
  render(
    <FullFileView
      {...props}
      file={file}
      compact
      initialScrollTop={1000}
      onScrollPosition={(top) => {
        position = top;
      }}
    />,
  );
  await expect.poll(() => lines()?.length ?? 0).toBeGreaterThan(0);
  await expect.poll(() => position).toBeGreaterThanOrEqual(1000);
  const scroller = Array.from(mount!.querySelectorAll("div")).find(
    (node) => getComputedStyle(node).overflowY === "auto",
  )!;
  expect(scroller.clientHeight).toBeLessThanOrEqual(420);
  expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
  const initial = position;
  await page.getByRole("region", { name: "Full file" }).wheel({ delta: { y: 600 } });
  await expect.poll(() => position).toBeGreaterThan(initial + 100);
  expect(lines()!.length).toBeLessThan(300);
  expect(document.documentElement.scrollTop).toBe(0);
});

test("Git blame is requested on demand and stale files hide attribution", async () => {
  const load = vi.fn<BlameLoader>(
    async (file: BrowseRead, startLine: number): Promise<BrowseBlame> => ({
      source: file.source,
      path: file.path,
      identity: file.identity,
      truncated: false,
      lines: [
        {
          line: startLine,
          commit: "a".repeat(40),
          author: "Mira",
          date: "2026-09-19T12:00:00Z",
          summary: "Add example",
        },
      ],
    }),
  );
  render(<FullFileView {...props} file={base} loadBlame={load} />);
  await expect.element(page.getByRole("button", { name: "Toggle Git blame" })).toBeVisible();
  expect(load).not.toHaveBeenCalled();
  await page.getByRole("button", { name: "Toggle Git blame" }).click();
  await expect.element(page.getByText("Mira")).toBeVisible();
  expect(load.mock.calls[0]?.slice(0, 2)).toEqual([base, 1]);
  root!.render(<FullFileView {...props} file={base} loadBlame={load} stale />);
  await expect
    .element(page.getByText("Refresh the file before reading its line history."))
    .toBeVisible();
  expect(mount!.textContent).not.toContain("Mira");
});

test("a late Git blame result cannot replace another file's line history", async () => {
  const requests: { file: BrowseRead; signal: AbortSignal; resolve(value: BrowseBlame): void }[] =
    [];
  const load = (file: BrowseRead, _start: number, _end: number, signal: AbortSignal) =>
    new Promise<BrowseBlame>((resolve) => requests.push({ file, signal, resolve }));
  render(<FullFileView {...props} file={base} loadBlame={load} blameEnabled />);
  await expect.poll(() => requests.length).toBe(1);
  const replacement = { ...base, path: "src/next.ts", identity: "next:1" };
  root!.render(<FullFileView {...props} file={replacement} loadBlame={load} blameEnabled />);
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[0]!.signal.aborted).toBe(true);
  requests[0]!.resolve({
    source: base.source,
    path: base.path,
    identity: base.identity,
    truncated: false,
    lines: [
      {
        line: 1,
        commit: "a".repeat(40),
        author: "Wrong file author",
        date: "",
        summary: "Old result",
      },
    ],
  });
  requests[1]!.resolve({
    source: replacement.source,
    path: replacement.path,
    identity: replacement.identity,
    truncated: false,
    lines: [
      {
        line: 1,
        commit: "0".repeat(40),
        author: "Not committed",
        date: "",
        summary: "Working changes",
      },
    ],
  });
  await expect.element(page.getByText("Uncommitted", { exact: true })).toBeVisible();
  expect(mount!.textContent).not.toContain("Wrong file author");
});

test("selecting a Pierre line number updates the bounded blame request", async () => {
  const load = vi.fn<BlameLoader>(async (file, startLine) => ({
    source: file.source,
    path: file.path,
    identity: file.identity,
    lines: [
      {
        line: startLine,
        commit: "a".repeat(40),
        author: "Mira",
        date: "",
        summary: `History of line ${startLine}`,
      },
    ],
    truncated: false,
  }));
  render(
    <FullFileView
      {...props}
      file={{ ...base, text: "one\ntwo\nthree\nfour\n" }}
      loadBlame={load}
      blameEnabled
    />,
  );
  await expect.element(page.getByText("History of line 1")).toBeVisible();
  await page.getByText("3", { exact: true }).click();
  await expect.element(page.getByText("History of line 3")).toBeVisible();
  expect(load.mock.calls.at(-1)?.slice(1, 3)).toEqual([3, 3]);
});

test("changing file identity refreshes contents and commit labels remain explicit", async () => {
  render(<FullFileView {...props} file={base} />);
  await expect
    .poll(() => document.querySelector("diffs-container")?.shadowRoot?.textContent)
    .toContain("example");
  root!.render(
    <FullFileView
      {...props}
      sourceLabel="Commit aaaaaaa · release"
      file={{
        ...base,
        identity: "example:2",
        text: "const replacement = 42;\n",
        source: { kind: "commit", repo: "/fixture", oid: "a".repeat(40) },
      }}
    />,
  );
  await expect.element(page.getByText("Commit aaaaaaa · release")).toBeVisible();
  await expect
    .poll(() => document.querySelector("diffs-container")?.shadowRoot?.textContent)
    .toContain("replacement");
  expect(document.querySelector("diffs-container")?.shadowRoot?.textContent).not.toContain(
    "export",
  );
});

test("a stale working file keeps its contents until explicit refresh", async () => {
  let refreshes = 0;
  render(<FullFileView {...props} file={base} stale onRefresh={() => refreshes++} />);
  await expect
    .poll(() => document.querySelector("diffs-container")?.shadowRoot?.textContent)
    .toContain("example");
  await expect
    .element(page.getByText("Workspace changed. Refresh this file to read the latest contents."))
    .toBeVisible();
  await page.getByRole("button", { name: "Refresh contents" }).click();
  expect(refreshes).toBe(1);
  expect(document.querySelector("diffs-container")?.shadowRoot?.textContent).toContain("example");
});

test("Changes stays available; preview file tabs can be pinned and closed", async () => {
  let selected = "";
  let closed = "";
  let pinned = "";
  render(
    <FileViewTabs
      tabs={[{ id: "a", path: "src/a.ts", pinned: false }]}
      active="a"
      onSelect={(id) => {
        selected = id;
      }}
      onClose={(id) => {
        closed = id;
      }}
      onPin={(id) => {
        pinned = id;
      }}
    />,
  );
  await page.getByRole("tab", { name: "Changes", exact: true }).click();
  expect(selected).toBe("changes");
  await expect
    .element(page.getByRole("tab", { name: "Changes", exact: true }))
    .toHaveAttribute("aria-controls", "file-view-panel");
  await page.getByRole("tab", { name: "a.ts", exact: true }).dblClick();
  expect(pinned).toBe("a");
  await page.getByRole("button", { name: "Close src/a.ts" }).click();
  expect(closed).toBe("a");
  await expect.element(page.getByRole("tab", { name: "Changes", exact: true })).toBeVisible();
});
