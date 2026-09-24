import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { HistoryPanel } from "../../src/web/components/HistoryPanel";
import { initializeTheme } from "../../src/web/themes";

let root: Root | undefined;
let mount: HTMLDivElement | undefined;
afterEach(() => {
  root?.unmount();
  mount?.remove();
  vi.restoreAllMocks();
});
let now: number;
function render() {
  now = Date.now();
  initializeTheme();
  mount = document.createElement("div");
  mount.style.cssText = "height:800px;width:400px";
  document.body.append(mount);
  root = createRoot(mount);
  root.render(
    <HistoryPanel
      commits={[
        {
          id: "a".repeat(40),
          parents: ["b".repeat(40)],
          subject: "First commit subject",
          author: "Alex",
          timestamp: now - 60_000,
          refs: ["main"],
        },
        {
          id: "b".repeat(40),
          parents: [],
          subject: "Second commit subject",
          author: "Sam",
          timestamp: now - 3_600_000,
          refs: [],
        },
      ]}
      loading={false}
      hasMore={false}
      error={null}
      working={false}
      onSelect={() => {}}
      onLoadMore={() => {}}
      onWorking={() => {}}
    />,
  );
}

test("shows compact elapsed author times and exact dates in a shared tooltip", async () => {
  await page.viewport(1280, 800);
  render();
  const first = page.getByRole("option").nth(0);
  const second = page.getByRole("option").nth(1);
  await expect
    .poll(() => document.querySelectorAll('[role="option"] time')[0]?.textContent)
    .toBe("1 min ago");
  await expect
    .poll(() => document.querySelectorAll('[role="option"] time')[1]?.textContent)
    .toBe("1 hr ago");
  expect(document.querySelector('[role="option"][title]')).toBeNull();
  expect(document.querySelector("time[title]")).toBeNull();

  // Observe the popup timestamp so browser automation latency does not affect
  // the initial delay or fast scanning assertions.
  let openedAt = 0;
  let secondAt = 0;
  const observer = new MutationObserver(() => {
    const text = document.querySelector('[role="tooltip"]')?.textContent;
    if (text?.includes("First commit subject") && !openedAt) openedAt = performance.now();
    if (text?.includes("Second commit subject") && !secondAt) secondAt = performance.now();
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  try {
    const started = performance.now();
    await first.hover();
    await expect
      .poll(() => document.querySelector('[role="tooltip"]')?.textContent)
      .toContain("Author date:");
    expect(openedAt - started).toBeGreaterThanOrEqual(400);
    expect(document.querySelector('[role="tooltip"] time')?.getAttribute("datetime")).toBe(
      new Date(now - 60_000).toISOString(),
    );
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("a".repeat(40));
    const scannedAt = performance.now();
    await second.hover();
    await expect
      .poll(() => document.querySelector('[role="tooltip"]')?.textContent)
      .toContain("Second commit subject");
    expect(secondAt - scannedAt).toBeLessThan(350);
    expect(document.querySelectorAll('[role="tooltip"]')).toHaveLength(1);
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("tooltip")).not.toBeInTheDocument();
  } finally {
    observer.disconnect();
  }
});

test("updates relative times while the history stays open", async () => {
  const intervals = vi.spyOn(window, "setInterval");
  render();
  await expect
    .poll(() => document.querySelector('[role="option"] time')?.textContent)
    .toBe("1 min ago");
  const clock = vi.spyOn(Date, "now").mockReturnValue(now + 60_000);
  const refresh = intervals.mock.calls.find(([, timeout]) => timeout === 30_000)![0];
  refresh();
  clock.mockRestore();
  await expect
    .poll(() => document.querySelector('[role="option"] time')?.textContent)
    .toBe("2 min ago");
});
