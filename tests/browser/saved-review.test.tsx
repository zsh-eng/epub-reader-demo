import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SavedReviewHeader } from "../../src/web/components/SavedReviewHeader";
import { createReviewController } from "../../src/web/data/controller";
import { initializeTheme } from "../../src/web/themes";
import type { SavedReview } from "../../src/shared/saved-review";

let root: Root | undefined;
let mount: HTMLDivElement | undefined;
afterEach(() => {
  root?.unmount();
  mount?.remove();
  root = undefined;
  mount = undefined;
});

async function setup() {
  const saved: SavedReview = {
    id: "review",
    title: "Agent work",
    createdAt: "2026-09-20T00:00:00Z",
    revision: 7,
    commentCount: 6,
    targets: [
      {
        id: "one",
        repositoryId: "repo1",
        repo: "/repos/frontend",
        branch: "main",
        label: "a → b",
        comparison: { kind: "range", base: "a", head: "b" },
        base: "a",
        head: "b",
        captured: false,
      },
      {
        id: "two",
        repositoryId: "repo1",
        repo: "/repos/frontend",
        branch: "main",
        label: "b → c",
        comparison: { kind: "range", base: "b", head: "c" },
        base: "b",
        head: "c",
        captured: false,
      },
      {
        id: "three",
        repositoryId: "repo2",
        repo: "/repos/backend",
        branch: "main",
        label: "working",
        comparison: { kind: "working" },
        base: "a",
        head: "snapshot",
        captured: true,
      },
    ],
  };
  const controller = createReviewController({ events: false });
  const copy = vi
    .spyOn(controller, "copyFeedback")
    .mockResolvedValue({ text: "Feedback", count: 6, repositoryCount: 2, revision: 7 });
  const clear = vi.spyOn(controller, "clearSavedComments").mockResolvedValue();
  const selected: string[] = [];
  let returned = 0;
  function Harness() {
    const [target, setTarget] = useState("one");
    const [browsing, setBrowsing] = useState(true);
    return (
      <SavedReviewHeader
        controller={controller}
        state={{
          ...controller.getSnapshot(),
          savedReview: saved,
          savedTargetId: target,
          savedView: true,
        }}
        browsing={browsing}
        onReturn={() => {
          returned += 1;
          setBrowsing(false);
        }}
        onTarget={(id) => {
          selected.push(id);
          setTarget(id);
        }}
      />
    );
  }
  initializeTheme();
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  root.render(<Harness />);
  await expect.element(page.getByRole("region", { name: "Saved review" })).toBeVisible();
  return { copy, clear, selected, returned: () => returned };
}

test("review header distinguishes ranges on the same branch and returns from file browsing", async () => {
  const { selected, returned } = await setup();
  await page.getByRole("combobox", { name: "Review target" }).selectOptions("two");
  expect(selected).toEqual(["two"]);
  await expect
    .element(page.getByRole("option", { name: "frontend · main · a → b" }))
    .toBeInTheDocument();
  await expect
    .element(page.getByRole("option", { name: "frontend · main · b → c" }))
    .toBeInTheDocument();
  await page.getByRole("button", { name: "Return to review changes" }).click();
  expect(returned()).toBe(1);
  await page.getByRole("combobox", { name: "Review target" }).selectOptions("three");
  await expect.element(page.getByText(/Captured working changes/)).toBeVisible();
});

test("copy includes all review targets and clear requires an explicit scoped confirmation", async () => {
  const { copy, clear } = await setup();
  await page.getByRole("button", { name: "Copy feedback" }).click();
  expect(copy).toHaveBeenCalledOnce();
  await expect
    .element(page.getByRole("status"))
    .toHaveTextContent("Copied 6 comments from 2 repositories.");
  await page.getByRole("button", { name: "Clear all comments" }).click();
  expect(clear).not.toHaveBeenCalled();
  await expect.element(page.getByRole("alert")).toBeVisible();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "Clear all comments across every target",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(clear).not.toHaveBeenCalled();
  await page.getByRole("button", { name: "Clear all comments" }).click();
  await page.getByRole("button", { name: "Confirm clear" }).click();
  expect(clear).toHaveBeenCalledWith(7);
  await expect
    .element(page.getByRole("status"))
    .toHaveTextContent("All comments in this review cleared.");
});
