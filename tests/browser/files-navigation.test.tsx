import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FilePicker, findFiles, parseFileQuery } from "../../src/web/components/FilePicker";
import { RepositoryFiles } from "../../src/web/components/RepositoryFiles";
import { useBrowseFiles, type BrowseApi } from "../../src/web/data/browse";
import type { BrowseEntry, BrowseList, BrowseSource } from "../../src/shared/browse";
import "../../src/web/reset.css";

beforeEach(async () => {
  await page.viewport(1200, 800);
});

let root: Root | undefined;
let mount: HTMLDivElement | undefined;
afterEach(() => {
  root?.unmount();
  mount?.remove();
  root = undefined;
  mount = undefined;
});
function render(element: React.ReactNode) {
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  root.render(element);
}
const entries: BrowseEntry[] = [
  { path: "src/main.ts", kind: "file" },
  { path: "src/menu.ts", kind: "file" },
  { path: "assets/logo.png", kind: "file" },
];

test("picker ranks filenames, bounds results, and parses file:line", () => {
  expect(findFiles(entries, "smt").map((entry) => entry.path)).toEqual([
    "src/main.ts",
    "src/menu.ts",
  ]);
  expect(
    findFiles([{ path: "main.ts/index.ts", kind: "file" }, ...entries], "main.ts")[0]?.path,
  ).toBe("src/main.ts");
  expect(
    findFiles(
      Array.from({ length: 100 }, (_, i) => ({ path: `${i}.ts`, kind: "file" })),
      "",
    ),
  ).toHaveLength(50);
  expect(parseFileQuery("main.ts:42:8")).toEqual({ text: "main.ts", line: 42 });
});

test("picker opens only a scoped result with an optional line", async () => {
  const onOpen = vi.fn<(path: string, line?: number) => void>();
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <FilePicker
        open={open}
        onOpenChange={setOpen}
        entries={entries}
        loading={false}
        error={null}
        sourceLabel="feature/auth · Working files"
        onOpen={onOpen}
      />
    );
  }
  render(<Harness />);
  await page.getByRole("combobox", { name: "Find file" }).fill("main.ts:42");
  await expect.element(page.getByRole("option", { name: "main.ts src" })).toBeVisible();
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => onOpen.mock.calls).toEqual([["src/main.ts", 42]]);
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
});

test("tree click previews, double-click pins, and directory clicks do not open files", async () => {
  const onPreview = vi.fn<(path: string) => void>();
  const onPin = vi.fn<(path: string) => void>();
  render(
    <div style={{ width: 300, height: 450 }}>
      <RepositoryFiles
        entries={entries}
        loading={false}
        error={null}
        truncated={false}
        sourceLabel="main · Working files"
        selectedPath={null}
        onPreview={onPreview}
        onPin={onPin}
        ignored={false}
        onIgnoredChange={() => {}}
        onRefresh={() => {}}
        onClose={() => {}}
      />
    </div>,
  );
  await page.getByRole("treeitem", { name: "main.ts", exact: true }).click();
  await expect.poll(() => onPreview.mock.calls).toEqual([["src/main.ts"]]);
  await page.getByRole("treeitem", { name: "main.ts", exact: true }).dblClick();
  await expect.poll(() => onPin.mock.calls).toEqual([["src/main.ts"]]);
  await page.getByRole("treeitem", { name: "src", exact: true }).dblClick();
  expect(onPin).toHaveBeenCalledTimes(1);
});

test("file lists load on demand and a stale worktree response cannot replace the new scope", async () => {
  const requests: {
    source: BrowseSource;
    signal?: AbortSignal;
    resolve(value: BrowseList): void;
  }[] = [];
  const api: BrowseApi = {
    list: (source, _ignored, signal) =>
      new Promise((resolve) => requests.push({ source, signal, resolve })),
    read: vi.fn<BrowseApi["read"]>(),
  };
  function Harness() {
    const [enabled, setEnabled] = useState(false);
    const [repo, setRepo] = useState("/first");
    const state = useBrowseFiles({ kind: "worktree", repo }, enabled, 0, { api });
    return (
      <>
        <button onClick={() => setEnabled(true)}>Enable</button>
        <button onClick={() => setRepo("/second")}>Switch</button>
        <output>{state.entries.map((entry) => entry.path).join(",")}</output>
      </>
    );
  }
  render(<Harness />);
  await expect.element(page.getByRole("button", { name: "Enable" })).toBeVisible();
  expect(requests).toHaveLength(0);
  await page.getByRole("button", { name: "Enable" }).click();
  await expect.poll(() => requests.length).toBe(1);
  await page.getByRole("button", { name: "Switch" }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[0]!.signal!.aborted).toBe(true);
  requests[1]!.resolve({
    source: requests[1]!.source,
    entries: [{ path: "second.ts", kind: "file" }],
    truncated: false,
  });
  await expect.element(page.getByRole("status")).toHaveTextContent("second.ts");
  requests[0]!.resolve({
    source: requests[0]!.source,
    entries: [{ path: "first.ts", kind: "file" }],
    truncated: false,
  });
  await expect.element(page.getByRole("status")).toHaveTextContent("second.ts");
});

test("Enter opens the first match after an async manifest and an empty query result", async () => {
  const onOpen = vi.fn<(path: string, line?: number) => void>();
  let load = () => {};
  function Harness() {
    const [loaded, setLoaded] = useState(false);
    const [open, setOpen] = useState(true);
    useEffect(() => {
      load = () => setLoaded(true);
    }, []);
    return (
      <FilePicker
        open={open}
        onOpenChange={setOpen}
        entries={loaded ? entries : []}
        loading={!loaded}
        error={null}
        sourceLabel="Async workspace"
        onOpen={onOpen}
      />
    );
  }
  render(<Harness />);
  const input = page.getByRole("combobox", { name: "Find file" });
  await input.fill("does-not-exist.ts:120");
  load();
  await expect.element(page.getByText("No matching files.")).toBeVisible();
  await userEvent.keyboard("{Enter}");
  expect(onOpen).not.toHaveBeenCalled();
  await input.fill("src");
  await expect.element(page.getByRole("option", { name: "main.ts src" })).toBeVisible();
  await input.fill("src/main.ts:120");
  await expect.element(page.getByRole("option", { name: "menu.ts src" })).not.toBeInTheDocument();
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => onOpen.mock.calls).toEqual([["src/main.ts", 120]]);
});

test("Enter preserves the option selected with arrow keys", async () => {
  const onOpen = vi.fn<(path: string, line?: number) => void>();
  render(
    <FilePicker
      open
      onOpenChange={() => {}}
      entries={entries}
      loading={false}
      error={null}
      sourceLabel="Working files"
      onOpen={onOpen}
    />,
  );
  await page.getByRole("combobox", { name: "Find file" }).fill("src");
  await expect
    .element(page.getByRole("option", { name: "main.ts src" }))
    .toHaveAttribute("data-highlighted");
  await userEvent.keyboard("{ArrowDown}");
  await expect
    .element(page.getByRole("option", { name: "menu.ts src" }))
    .toHaveAttribute("data-highlighted");
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => onOpen.mock.calls).toEqual([["src/menu.ts", undefined]]);
});

test("an externally opened deep file expands its parent folders and becomes visible", async () => {
  const onPreview = vi.fn<(path: string) => void>();
  const deepEntries: BrowseEntry[] = [
    ...entries,
    { path: "src/js/node/_http_client.ts", kind: "file" },
    { path: "src/js/web/fetch.ts", kind: "file" },
  ];
  let select = () => {};
  function Harness() {
    const [selected, setSelected] = useState<string | null>(null);
    useEffect(() => {
      select = () => setSelected("src/js/node/_http_client.ts");
    }, []);
    return (
      <div style={{ width: 300, height: 450 }}>
        <RepositoryFiles
          entries={deepEntries}
          loading={false}
          error={null}
          truncated={false}
          sourceLabel="Working files"
          selectedPath={selected}
          onPreview={onPreview}
          onPin={() => {}}
          ignored={false}
          onIgnoredChange={() => {}}
          onRefresh={() => {}}
          onClose={() => {}}
        />
      </div>
    );
  }
  render(<Harness />);
  await expect.element(page.getByRole("treeitem", { name: "src", exact: true })).toBeVisible();
  await expect
    .element(page.getByRole("treeitem", { name: "_http_client.ts", exact: true }))
    .not.toBeInTheDocument();
  select();
  await expect
    .element(page.getByRole("treeitem", { name: "_http_client.ts", exact: true }))
    .toBeVisible();
  await expect
    .element(page.getByRole("treeitem", { name: "_http_client.ts", exact: true }))
    .toHaveAttribute("aria-selected", "true");
  expect(onPreview).not.toHaveBeenCalled();
});

test("picker ranks open and recent files without introducing another workspace's paths", () => {
  expect(
    findFiles(entries, "", ["src/menu.ts", "foreign.ts"], ["assets/logo.png"]).map(
      (file) => file.path,
    ),
  ).toEqual(["src/menu.ts", "assets/logo.png", "src/main.ts"]);
  expect(findFiles(entries, "main.ts", ["src/menu.ts"])[0]?.path).toBe("src/main.ts");
});

test("preview follows selection, cancels stale reads, and Escape leaves the current tab unchanged", async () => {
  type Read = Awaited<ReturnType<BrowseApi["read"]>>;
  const requests: {
    source: BrowseSource;
    path: string;
    signal?: AbortSignal;
    resolve(file: Read): void;
  }[] = [];
  const api: BrowseApi = {
    list: vi.fn<BrowseApi["list"]>(),
    read: (source, path, signal) =>
      new Promise((resolve) => requests.push({ source, path, signal, resolve })),
  };
  const onOpen = vi.fn<(path: string, line?: number) => void>();
  let reopen = () => {};
  function Harness() {
    const [open, setOpen] = useState(true);
    useEffect(() => {
      reopen = () => setOpen(true);
    }, []);
    return (
      <FilePicker
        open={open}
        onOpenChange={setOpen}
        entries={entries}
        loading={false}
        error={null}
        sourceLabel="Current worktree"
        source={{ kind: "worktree", repo: "/current" }}
        api={api}
        onOpen={onOpen}
      />
    );
  }
  render(<Harness />);
  await page.getByRole("combobox", { name: "Find file" }).fill("src");
  await expect.poll(() => requests.length).toBe(1);
  await userEvent.keyboard("{ArrowDown}");
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[0]!.signal?.aborted).toBe(true);
  requests[1]!.resolve({
    source: requests[1]!.source,
    path: requests[1]!.path,
    kind: "binary",
    size: 20,
    identity: "menu",
  });
  await expect
    .element(page.getByText("Binary file — content preview is not available."))
    .toBeVisible();
  requests[0]!.resolve({
    source: requests[0]!.source,
    path: requests[0]!.path,
    kind: "missing",
    size: 0,
    identity: "main",
  });
  await expect
    .element(page.getByText("Binary file — content preview is not available."))
    .toBeVisible();
  expect(onOpen).not.toHaveBeenCalled();
  await userEvent.keyboard("{Escape}");
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  expect(onOpen).not.toHaveBeenCalled();
  reopen();
  await expect.element(page.getByRole("combobox", { name: "Find file" })).toHaveValue("src");
  await expect.poll(() => requests.length).toBe(3);
  expect(requests[2]!.path).toBe("src/menu.ts");
  await userEvent.keyboard("{Enter}");
  expect(onOpen).toHaveBeenCalledWith("src/menu.ts", undefined);
});

test("content search is scoped, previews the matching line, and resumes its last mode", async () => {
  const api: BrowseApi = {
    list: vi.fn<BrowseApi["list"]>(),
    read: vi.fn<BrowseApi["read"]>(async (source, path) => ({
      source,
      path,
      kind: "text" as const,
      size: 18,
      identity: path,
      text: "first\nneedle\nlast\n",
    })),
    search: vi.fn<NonNullable<BrowseApi["search"]>>(async (source, query) => ({
      source,
      query,
      matches: [{ path: "src/main.ts", line: 2, text: "needle" }],
      truncated: false,
    })),
  };
  const onOpen = vi.fn<(path: string, line?: number) => void>();
  let reopen = () => {};
  function Harness() {
    const [open, setOpen] = useState(true);
    useEffect(() => {
      reopen = () => setOpen(true);
    }, []);
    return (
      <FilePicker
        open={open}
        onOpenChange={setOpen}
        entries={entries}
        loading={false}
        error={null}
        sourceLabel="Feature worktree"
        source={{ kind: "worktree", repo: "/feature" }}
        api={api}
        onOpen={onOpen}
        resume
      />
    );
  }
  render(<Harness />);
  await page.getByRole("button", { name: "Content", exact: true }).click();
  await page.getByRole("combobox", { name: "Search file contents" }).fill("needle");
  await expect.element(page.getByRole("option", { name: "main.ts:2 src needle" })).toBeVisible();
  expect(api.search).toHaveBeenCalledWith(
    { kind: "worktree", repo: "/feature" },
    "needle",
    expect.any(AbortSignal),
  );
  await expect
    .poll(() => api.read)
    .toHaveBeenCalledWith(
      { kind: "worktree", repo: "/feature" },
      "src/main.ts",
      expect.any(AbortSignal),
    );
  await userEvent.keyboard("{Escape}");
  reopen();
  await expect
    .element(page.getByRole("combobox", { name: "Search file contents" }))
    .toHaveValue("needle");
  await expect.element(page.getByRole("option", { name: "main.ts:2 src needle" })).toBeVisible();
  await userEvent.keyboard("{Enter}");
  expect(onOpen).toHaveBeenCalledWith("src/main.ts", 2);
});

test("a late preview from a different workspace cannot replace the active preview", async () => {
  type Read = Awaited<ReturnType<BrowseApi["read"]>>;
  const requests: {
    source: BrowseSource;
    path: string;
    signal?: AbortSignal;
    resolve(file: Read): void;
  }[] = [];
  const api: BrowseApi = {
    list: vi.fn<BrowseApi["list"]>(),
    read: (source, path, signal) =>
      new Promise((resolve) => requests.push({ source, path, signal, resolve })),
  };
  let switchSource = () => {};
  function Harness() {
    const [repo, setRepo] = useState("/first");
    useEffect(() => {
      switchSource = () => setRepo("/second");
    }, []);
    return (
      <FilePicker
        open
        onOpenChange={() => {}}
        entries={[{ path: "file.ts", kind: "file" }]}
        loading={false}
        error={null}
        sourceLabel={repo}
        source={{ kind: "worktree", repo }}
        api={api}
        onOpen={() => {}}
      />
    );
  }
  render(<Harness />);
  await expect.poll(() => requests.length).toBe(1);
  switchSource();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[0]!.signal?.aborted).toBe(true);
  requests[1]!.resolve({
    source: requests[1]!.source,
    path: "file.ts",
    kind: "binary",
    size: 20,
    identity: "second",
  });
  await expect
    .element(page.getByText("Binary file — content preview is not available."))
    .toBeVisible();
  requests[0]!.resolve({
    source: requests[0]!.source,
    path: "file.ts",
    kind: "missing",
    size: 0,
    identity: "first",
  });
  await expect
    .element(page.getByText("Binary file — content preview is not available."))
    .toBeVisible();
});

test("preview scroll position is restored after Escape and reopen", async () => {
  const api: BrowseApi = {
    list: vi.fn<BrowseApi["list"]>(),
    read: vi.fn<BrowseApi["read"]>(async (source, path) => ({
      source,
      path,
      kind: "text",
      size: 20000,
      identity: "long",
      plain: true,
      text: Array.from({ length: 2000 }, (_, i) => `line ${i + 1}\n`).join(""),
    })),
  };
  let reopen = () => {};
  function Harness() {
    const [open, setOpen] = useState(true);
    useEffect(() => {
      reopen = () => setOpen(true);
    }, []);
    return (
      <FilePicker
        open={open}
        onOpenChange={setOpen}
        entries={[{ path: "long.txt", kind: "file" }]}
        loading={false}
        error={null}
        sourceLabel="Current worktree"
        source={{ kind: "worktree", repo: "/current" }}
        api={api}
        onOpen={() => {}}
      />
    );
  }
  render(<Harness />);
  const scroller = () =>
    Array.from(document.querySelectorAll<HTMLElement>('[aria-label="Full file"] div')).find(
      (node) => getComputedStyle(node).overflowY === "auto",
    );
  await expect.poll(() => scroller()?.scrollHeight ?? 0).toBeGreaterThan(1000);
  await page.getByRole("region", { name: "Full file" }).wheel({ delta: { y: 800 } });
  await expect.poll(() => scroller()?.scrollTop ?? 0).toBeGreaterThan(200);
  const top = scroller()!.scrollTop;
  await userEvent.keyboard("{Escape}");
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  reopen();
  await expect.poll(() => scroller()?.scrollTop ?? 0).toBeGreaterThan(top - 5);
  expect(scroller()!.scrollTop).toBeLessThan(top + 5);
});

test("resume uses the most recently opened mode even when it was not toggled", async () => {
  const api: BrowseApi = {
    list: vi.fn<BrowseApi["list"]>(),
    read: vi.fn<BrowseApi["read"]>(),
    search: vi.fn<NonNullable<BrowseApi["search"]>>(),
  };
  let launch = (_mode: "files" | "content", _resume: boolean) => {};
  function Harness() {
    const [open, setOpen] = useState(true);
    const [mode, setMode] = useState<"files" | "content">("content");
    const [resume, setResume] = useState(false);
    useEffect(() => {
      launch = (next, restore) => {
        setMode(next);
        setResume(restore);
        setOpen(true);
      };
    }, []);
    return (
      <FilePicker
        open={open}
        onOpenChange={setOpen}
        entries={[]}
        loading={false}
        error={null}
        sourceLabel="Current"
        initialMode={mode}
        resume={resume}
        api={api}
        onOpen={() => {}}
      />
    );
  }
  render(<Harness />);
  await expect.element(page.getByRole("combobox", { name: "Search file contents" })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  launch("files", false);
  await expect.element(page.getByRole("combobox", { name: "Find file" })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  launch("content", true);
  await expect.element(page.getByRole("combobox", { name: "Find file" })).toBeVisible();
});
