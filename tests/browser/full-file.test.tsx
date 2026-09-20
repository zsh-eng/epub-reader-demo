import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
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

test("a preview is positioned at its target before its first visible frame", async () => {
  const file: BrowseRead = {
    ...base,
    identity: "first-frame:1",
    plain: true,
    text: Array.from({ length: 2000 }, (_, i) => `line ${i + 1}\n`).join(""),
  };
  render(<FullFileView {...props} file={file} compact />);
  await expect.poll(() => lines()?.length ?? 0).toBeGreaterThan(0);
  const frames: number[] = [];
  let frame = 0;
  const sample = () => {
    const container = document.querySelector("diffs-container");
    if (container?.shadowRoot?.querySelector("[data-line]")) {
      const scroller = Array.from(mount!.querySelectorAll("div")).find(
        (node) => getComputedStyle(node).overflowY === "auto",
      );
      if (scroller) frames.push(scroller.scrollTop);
    }
    frame = requestAnimationFrame(sample);
  };
  frame = requestAnimationFrame(sample);
  try {
    flushSync(() =>
      root!.render(
        <FullFileView
          {...props}
          file={{ ...file, identity: "first-frame:2" }}
          compact
          line={1500}
        />,
      ),
    );
    await expect.poll(() => frames.length).toBeGreaterThan(2);
    expect(frames.every((top) => top > 20_000)).toBe(true);
    await expect
      .poll(() =>
        document
          .querySelector("diffs-container")
          ?.shadowRoot?.querySelector('[data-line="1500"][data-selected-line]'),
      )
      .not.toBeNull();
  } finally {
    cancelAnimationFrame(frame);
  }
});

function searchRanges() {
  return Array.from(CSS.highlights)
    .filter(([name]) => name.startsWith("med-search-"))
    .flatMap(([, highlight]) => Array.from(highlight) as Range[]);
}

test("search highlights span syntax tokens, use literal text, and clear when the preview changes", async () => {
  const file = {
    ...base,
    identity: "highlight:1",
    text: "const value = fn(value); // İ 🙂 FN(value)\n",
  };
  render(<FullFileView {...props} compact file={file} highlightQuery="fn(value)" />);
  await expect
    .poll(() => searchRanges().map((range) => range.toString()))
    .toEqual(["fn(value)", "FN(value)"]);
  const shadow = document.querySelector("diffs-container")!.shadowRoot!;
  // Highlight overlays must not insert markup or remove syntax tokens.
  expect(shadow.querySelector("mark")).toBeNull();
  expect(shadow.querySelector("[data-line]")?.textContent).toContain(file.text.trim());
  await expect
    .poll(() => searchRanges()[0]?.startContainer !== searchRanges()[0]?.endContainer)
    .toBe(true);

  root!.render(<FullFileView {...props} compact file={file} highlightQuery="İ 🙂" />);
  await expect.poll(() => searchRanges().map((range) => range.toString())).toEqual(["İ 🙂"]);
  root!.render(<FullFileView {...props} compact file={file} highlightQuery="" />);
  await expect.poll(() => searchRanges().length).toBe(0);
  root!.render(<FullFileView {...props} compact file={file} highlightQuery="value" />);
  await expect.poll(() => searchRanges().length).toBe(3);
  root!.render(
    <FullFileView {...props} compact file={{ ...base, kind: "binary" }} highlightQuery="value" />,
  );
  await expect.poll(() => searchRanges().length).toBe(0);
});

test("search highlights follow virtualized rows and release their ranges on close", async () => {
  const file = {
    ...base,
    identity: "highlight-scroll:1",
    plain: true,
    text: Array.from({ length: 2000 }, (_, i) => `needle ${i + 1}\n`).join(""),
  };
  render(<FullFileView {...props} compact file={file} highlightQuery="needle" />);
  await expect.poll(() => searchRanges().length).toBeGreaterThan(0);
  const firstText = searchRanges()[0]!.startContainer.textContent;
  await page.getByRole("region", { name: "Full file" }).wheel({ delta: { y: 4000 } });
  await expect.poll(() => searchRanges()[0]?.startContainer.textContent).not.toBe(firstText);
  expect(
    searchRanges().every(
      (range) => range.startContainer.isConnected && range.toString() === "needle",
    ),
  ).toBe(true);
  expect(searchRanges().length).toBeLessThan(300);
  root!.unmount();
  root = undefined;
  expect(searchRanges()).toEqual([]);
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

test("Vim moves a logical cursor through a virtualized file and searches exact text", async () => {
  const file = {
    ...base,
    plain: true,
    identity: "vim-large",
    text: Array.from({ length: 40000 }, (_, i) => `value${i} = example;\n`).join(""),
  };
  render(<FullFileView {...props} file={file} vimEnabled />);
  await expect.poll(() => lines()?.length ?? 0).toBeGreaterThan(0);
  const pane = document.querySelector<HTMLElement>('[aria-label="File navigation"]')!;
  pane.focus();
  const key = (value: string, ctrlKey = false) =>
    pane.dispatchEvent(
      new KeyboardEvent("keydown", { key: value, ctrlKey, bubbles: true, cancelable: true }),
    );
  for (const value of "39000G") key(value);
  expect(pane.dataset.vimLine).toBe("39000");
  expect(lines()!.length).toBeLessThan(300);
  await expect
    .poll(() => document.querySelector<HTMLElement>("[data-vim-caret]")!.hidden)
    .toBe(false);
  key("w");
  expect(Number(pane.dataset.vimColumn)).toBeGreaterThan(1);
  key("/");
  await expect.element(page.getByRole("textbox", { name: "Search in file" })).toBeVisible();
  await page.getByRole("textbox", { name: "Search in file" }).fill("value39990");
  await expect.poll(() => pane.dataset.vimLine).toBe("39991");
  await page
    .getByRole("textbox", { name: "Search in file" })
    .element()
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  // Submit the form explicitly: synthetic keyboard events do not trigger native submit.
  page.getByRole("textbox", { name: "Search in file" }).element().closest("form")!.requestSubmit();
  await expect.poll(() => pane.dataset.vimLine).toBe("39991");
  key("z");
  key("z");
  await expect
    .poll(() => document.querySelector<HTMLElement>("[data-vim-caret]")!.hidden)
    .toBe(false);
});

test("Vim incremental search uses smart case, accepts once, and Escape clears highlights", async () => {
  render(
    <FullFileView
      {...props}
      file={{
        ...base,
        plain: true,
        identity: "incremental",
        text: "intro\nFOO\nFoo\nfoo\nFoo\nend\n",
      }}
      vimEnabled
    />,
  );
  const pane = page.getByRole("textbox", { name: "File navigation", exact: true });
  await expect.element(pane).toBeVisible();
  const element = pane.element() as HTMLElement;
  const key = (key: string) =>
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  element.focus();
  key("/");
  const input = page.getByRole("textbox", { name: "Search in file", exact: true });
  await input.fill("f");
  await expect.element(pane).toHaveAttribute("data-vim-line", "2");
  await input.fill("foo");
  await expect
    .poll(() => searchRanges().map((range) => range.toString()))
    .toEqual(["FOO", "Foo", "foo", "Foo"]);
  await expect.element(pane).toHaveAttribute("data-vim-line", "2");
  await input.fill("Foo");
  await expect.element(pane).toHaveAttribute("data-vim-line", "3");
  await expect.poll(() => searchRanges().map((range) => range.toString())).toEqual(["Foo", "Foo"]);
  await userEvent.keyboard("{Enter}");
  await expect.element(input).not.toBeInTheDocument();
  await expect.element(pane).toHaveAttribute("data-vim-line", "3");
  key("n");
  await expect.element(pane).toHaveAttribute("data-vim-line", "5");
  key("Escape");
  await expect.poll(() => searchRanges().length).toBe(0);
  await expect.element(pane).toHaveAttribute("data-vim-line", "5");
  key("/");
  await input.fill("intro");
  await expect.element(pane).toHaveAttribute("data-vim-line", "1");
  await userEvent.keyboard("{Escape}");
  await expect.element(pane).toHaveAttribute("data-vim-line", "5");
  await expect.poll(() => searchRanges().length).toBe(0);
  key("n");
  await expect.element(pane).toHaveAttribute("data-vim-line", "3");
  await expect.poll(() => searchRanges().map((range) => range.toString())).toEqual(["Foo", "Foo"]);
});

test("Vim backward preview and an empty query restore the starting position", async () => {
  render(
    <FullFileView
      {...props}
      file={{
        ...base,
        plain: true,
        identity: "backward-incremental",
        text: "intro\nfoo\nFoo\nfoo\nend\n",
      }}
      vimEnabled
    />,
  );
  const pane = page.getByRole("textbox", { name: "File navigation", exact: true });
  await expect.element(pane).toBeVisible();
  const element = pane.element() as HTMLElement;
  element.focus();
  const key = (key: string) =>
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  key("G");
  key("?");
  const input = page.getByRole("textbox", { name: "Search in file", exact: true });
  await input.fill("f");
  await expect.element(pane).toHaveAttribute("data-vim-line", "4");
  await input.fill("foo");
  await expect.element(pane).toHaveAttribute("data-vim-line", "4");
  await input.fill("");
  await expect.element(pane).toHaveAttribute("data-vim-line", "5");
  await expect.poll(() => searchRanges().length).toBe(0);
  await input.fill("missing");
  await expect.element(page.getByText("No matches · missing", { exact: false })).toBeVisible();
  await expect.element(pane).toHaveAttribute("data-vim-line", "5");
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => document.activeElement).toBe(element);
});

test("Vim ignores old worker results after query changes and Escape", async () => {
  const sent: { worker: Worker; id: number; query: string }[] = [];
  vi.spyOn(Worker.prototype, "postMessage").mockImplementation(function (this: Worker, message) {
    if (message.id !== -1) sent.push({ worker: this, ...message });
  });
  render(
    <FullFileView
      {...props}
      file={{ ...base, plain: true, identity: "incremental-races", text: "intro\nfoo\nbar\n" }}
      vimEnabled
    />,
  );
  const pane = page.getByRole("textbox", { name: "File navigation", exact: true });
  await expect.element(pane).toBeVisible();
  const element = pane.element() as HTMLElement;
  element.focus();
  element.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
  const input = page.getByRole("textbox", { name: "Search in file", exact: true });
  await input.fill("foo");
  await input.fill("bar");
  const deliver = (item: (typeof sent)[number], matches: number[]) =>
    item.worker.onmessage?.call(
      item.worker,
      new MessageEvent("message", { data: { id: item.id, matches: Uint32Array.from(matches) } }),
    );
  deliver(sent[0]!, [6]);
  await expect.element(pane).toHaveAttribute("data-vim-line", "1");
  deliver(sent[1]!, [10]);
  await expect.element(pane).toHaveAttribute("data-vim-line", "3");
  await input.fill("foo");
  await input.fill("");
  deliver(sent[2]!, [6]);
  await expect.element(pane).toHaveAttribute("data-vim-line", "1");
  await expect.poll(() => searchRanges().length).toBe(0);
  await input.fill("bar");
  await userEvent.keyboard("{Escape}");
  deliver(sent[3]!, [10]);
  await expect.element(pane).toHaveAttribute("data-vim-line", "1");
  await expect.poll(() => searchRanges().length).toBe(0);
  element.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
  await input.fill("foo");
  flushSync(() =>
    root!.render(
      <FullFileView
        {...props}
        file={{ ...base, plain: true, identity: "replacement", text: "new source\n" }}
        vimEnabled
      />,
    ),
  );
  deliver(sent[4]!, [6]);
  await expect.element(input).not.toBeInTheDocument();
  await expect.element(pane).toHaveAttribute("data-vim-line", "1");
  await expect.poll(() => searchRanges().length).toBe(0);
});

test("Vim ignores commands outside its pane and preserves standard input keys", async () => {
  render(<FullFileView {...props} file={base} vimEnabled />);
  await expect.poll(() => lines()?.length ?? 0).toBeGreaterThan(0);
  const pane = document.querySelector<HTMLElement>('[aria-label="File navigation"]')!;
  const event = new KeyboardEvent("keydown", { key: "?", bubbles: true, cancelable: true });
  pane.focus();
  pane.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  await expect.element(page.getByRole("textbox", { name: "Search in file" })).toBeVisible();
  await page.getByRole("textbox", { name: "Search in file" }).fill("jj{}");
  expect(pane.dataset.vimLine).toBe("1");
  const input = page.getByRole("textbox", { name: "Search in file" }).element();
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  await expect
    .element(page.getByRole("textbox", { name: "Search in file" }))
    .not.toBeInTheDocument();
});

test("benchmark: Vim cursor response on 40k lines and a 100k-character line", async ({
  annotate,
}) => {
  const percentile = (values: number[], p: number) =>
    [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * p)]!;
  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const scenarios = [
    {
      name: "40000-lines-local",
      text: Array.from({ length: 40000 }, (_, i) => `export const value${i} = ${i};\n`).join(""),
      commands: ["j", "k", "w", "b"],
    },
    {
      name: "40000-lines-scroll",
      text: Array.from({ length: 40000 }, (_, i) => `export const value${i} = ${i};\n`).join(""),
      commands: ["j"],
    },
    {
      name: "40000-lines-far-jump",
      text: Array.from({ length: 40000 }, (_, i) => `export const value${i} = ${i};\n`).join(""),
      commands: ["G", "g", "g"],
    },
    {
      name: "100000-character-line",
      text: `${"word ".repeat(20000)}\nnext line\n`,
      commands: ["$", "h", "l", "0", "w", "b"],
    },
  ];
  const results = [];
  for (const scenario of scenarios) {
    const file = {
      ...base,
      plain: true,
      identity: `benchmark-${scenario.name}`,
      text: scenario.text,
      size: scenario.text.length,
    };
    if (!root) render(<FullFileView {...props} file={file} vimEnabled />);
    else flushSync(() => root!.render(<FullFileView {...props} file={file} vimEnabled />));
    await expect.poll(() => lines()?.length ?? 0).toBeGreaterThan(0);
    await frame();
    const pane = document.querySelector<HTMLElement>('[aria-label="File navigation"]')!;
    pane.focus();
    const handlers: number[] = [],
      frames: number[] = [];
    for (let i = 0; i < 70; i++) {
      await frame();
      const started = performance.now();
      pane.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: scenario.commands[i % scenario.commands.length]!,
          bubbles: true,
          cancelable: true,
        }),
      );
      handlers.push(performance.now() - started);
      await frame();
      const cursor = document.querySelector<HTMLElement>("[data-vim-caret]")!;
      for (
        let attempt = 0;
        attempt < 20 &&
        (cursor.hidden ||
          cursor.dataset.vimLine !== pane.dataset.vimLine ||
          cursor.dataset.vimColumn !== pane.dataset.vimColumn);
        attempt++
      )
        await frame();
      expect(cursor.hidden).toBe(false);
      expect(cursor.dataset.vimLine).toBe(pane.dataset.vimLine);
      expect(cursor.dataset.vimColumn).toBe(pane.dataset.vimColumn);
      frames.push(performance.now() - started);
    }
    results.push({
      scenario: scenario.name,
      bytes: file.size,
      samples: handlers.length,
      handlerP50Ms: percentile(handlers, 0.5),
      handlerP95Ms: percentile(handlers, 0.95),
      handlerMaxMs: Math.max(...handlers),
      nextFrameP50Ms: percentile(frames, 0.5),
      nextFrameP95Ms: percentile(frames, 0.95),
      mountedRows: lines()!.length,
    });
    expect(lines()!.length).toBeLessThan(300);
  }
  await annotate(`VIM_BROWSER_BENCHMARK ${JSON.stringify(results)}`, "benchmark", {
    contentType: "application/json",
    body: JSON.stringify(results, null, 2),
    bodyEncoding: "utf-8",
  });
}, 30000);

test("Vim blank-line cursor is one cell wide and only cursor moves animate", async () => {
  render(
    <FullFileView
      {...props}
      file={{ ...base, plain: true, text: "0000\n\nnext\n", identity: "empty-caret" }}
      vimEnabled
    />,
  );
  const pane = page.getByRole("textbox", { name: "File navigation" });
  await expect.element(pane).toBeVisible();
  await expect.poll(() => document.activeElement).toBe(pane.element());
  const caret = document.querySelector<HTMLElement>("[data-vim-caret]")!;
  await expect.poll(() => caret.hidden).toBe(false);
  const width = caret.getBoundingClientRect().width;
  await userEvent.keyboard("j");
  await expect.element(pane).toHaveAttribute("data-vim-line", "2");
  expect(caret.style.width).toBe("1ch");
  expect(Math.abs(caret.getBoundingClientRect().width - width)).toBeLessThan(0.6);
  expect(caret.getBoundingClientRect().width).toBeGreaterThan(5);
  expect(caret.getBoundingClientRect().width).toBeLessThan(12);
  // Check the next key synchronously; initial font/resize events may cancel
  // the first transition, as they should when viewport geometry changes.
  pane
    .element()
    .dispatchEvent(new KeyboardEvent("keydown", { key: "k", bubbles: true, cancelable: true }));
  expect(getComputedStyle(caret).transitionTimingFunction).toBe("ease-out");
  expect(getComputedStyle(caret).transitionProperty).toBe("left, top");
  expect(getComputedStyle(caret).transitionDuration).toBe("0.065s");
  pane.element().dispatchEvent(new Event("scroll"));
  expect(getComputedStyle(caret).transitionProperty).toBe("none");
});

test("Shift+A and z commands position the cursor and viewport in a virtualized file", async () => {
  render(
    <FullFileView
      {...props}
      file={{ ...base, plain: true, identity: "vim-alignment", text: "  abcdef\n".repeat(4000) }}
      vimEnabled
    />,
  );
  const pane = page.getByRole("textbox", { name: "File navigation" });
  await expect.element(pane).toBeVisible();
  await expect.poll(() => document.activeElement).toBe(pane.element());
  const scroller = [...pane.element().querySelectorAll("div")].find(
    (node) => getComputedStyle(node).overflowY === "auto",
  )!;
  const caret = document.querySelector<HTMLElement>("[data-vim-caret]")!;
  await userEvent.keyboard("2000G{Shift>}A{/Shift}");
  await expect.element(pane).toHaveAttribute("data-vim-line", "2000");
  await expect.element(pane).toHaveAttribute("data-vim-column", "8");
  for (const [keys, align] of [
    ["zz", "center"],
    ["zt", "start"],
    ["zb", "end"],
    ["zb", "end"],
  ]) {
    await userEvent.keyboard(keys!);
    await expect
      .poll(() => {
        const row = document
          .querySelector("diffs-container")
          ?.shadowRoot?.querySelector('[data-line="2000"]');
        if (!row) return Infinity;
        const bounds = row.getBoundingClientRect();
        const viewport = scroller.getBoundingClientRect();
        return Math.abs(
          align === "start"
            ? bounds.top - viewport.top
            : align === "end"
              ? bounds.bottom - viewport.bottom
              : (bounds.top + bounds.bottom - viewport.top - viewport.bottom) / 2,
        );
      })
      .toBeLessThan(2);
    await expect.poll(() => caret.hidden).toBe(false);
    await expect.element(pane).toHaveAttribute("data-vim-line", "2000");
    await expect.element(pane).toHaveAttribute("data-vim-column", "8");
    expect(lines()!.length).toBeLessThan(300);
  }
  // Clamping at the file boundary must not leave the cursor hidden.
  await userEvent.keyboard("ggzbzb");
  await expect.element(pane).toHaveAttribute("data-vim-line", "1");
  await expect.poll(() => caret.hidden).toBe(false);
  await expect.poll(() => scroller.scrollTop).toBe(0);
});
