import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { ComparisonActions } from "../../src/web/components/ComparisonActions";
import { initializeTheme } from "../../src/web/themes";

let root: Root | undefined;
let mount: HTMLDivElement | undefined;
afterEach(() => {
  root?.unmount();
  mount?.remove();
  vi.unstubAllGlobals();
});
const head = "a".repeat(40);
async function setup(commit = head) {
  initializeTheme();
  const push = vi.fn<(body: unknown) => void>();
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).startsWith("/api/git/targets"))
        return Response.json({
          branch: "feature",
          head,
          refs: [
            { name: "refs/heads/main", label: "main" },
            { name: "refs/remotes/origin/develop", label: "origin/develop" },
          ],
          remotes: [{ name: "origin", branches: ["main", "feature"] }],
        });
      const body = JSON.parse(String(init?.body));
      push(body);
      return Response.json(body);
    }),
  );
  const compare = vi.fn<(base: string, head: string) => void>();
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  root.render(
    <ComparisonActions
      repo="/test/repo"
      sourceBranch="reviewed-feature"
      head={commit}
      comparison={{ kind: "commit", commit }}
      onCompare={compare}
    />,
  );
  await expect
    .element(page.getByRole("button", { name: "Compare against base branch" }))
    .toBeVisible();
  return { compare, push };
}

test("filter a base branch and compare without publishing", async () => {
  const { compare, push } = await setup();
  await page.getByRole("button", { name: "Compare against base branch" }).click();
  await page.getByRole("textbox", { name: "Filter comparison branches" }).fill("develop");
  await expect
    .element(page.getByRole("menuitem", { name: "main", exact: true }))
    .not.toBeInTheDocument();
  await page.getByRole("menuitem", { name: "origin/develop" }).click();
  expect(compare).toHaveBeenCalledWith("refs/remotes/origin/develop", head);
  expect(push).not.toHaveBeenCalled();
});

test("push waits for explicit confirmation and sends the shown commit and new branch", async () => {
  const { push } = await setup();
  await page.getByRole("button", { name: "Push", exact: true }).click();
  await expect
    .element(
      page.getByText(
        "Publish commit aaaaaaaa and its history. Uncommitted files are not included.",
      ),
    )
    .toBeVisible();
  expect(push).not.toHaveBeenCalled();
  await expect
    .element(page.getByRole("combobox", { name: "Destination branch" }))
    .toHaveValue("reviewed-feature");
  await page.getByRole("combobox", { name: "Destination branch" }).fill("review/new");
  await page.getByRole("button", { name: "Push to origin" }).click();
  await expect.poll(() => push.mock.calls).toHaveLength(1);
  expect(push).toHaveBeenCalledWith({
    repo: "/test/repo",
    head,
    remote: "origin",
    branch: "review/new",
  });
  await expect
    .element(page.getByRole("status"))
    .toHaveTextContent("Pushed aaaaaaaa to origin/review/new");
});

test("a working snapshot cannot silently publish the repository HEAD", async () => {
  await setup("worktree");
  await expect.element(page.getByRole("button", { name: "Push", exact: true })).toBeDisabled();
});
