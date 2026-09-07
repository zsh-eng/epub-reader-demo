import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { click, render } from "../../tests/dom";
import ImportRoute from "./ImportRoute";
import type { ParsedBundle } from "@/lib/import/browser";
import MemoryDB from "@/lib/db/memory";

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
  localStorage.clear();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function bundle(front = "Question"): ParsedBundle {
  return {
    entries: new Map(),
    manifest: {
      version: "spaced-bundle-v1",
      generatedAt: new Date().toISOString(),
      source: { type: "obsidian", vaultRoot: "/vault", inputs: ["note.md"] },
      warnings: [],
      cards: [
        {
          front,
          back: "Answer",
          assets: [],
          source: { file: "note.md", lineStart: 1, lineEnd: 2 },
        },
      ],
    },
  };
}
async function choose(container: HTMLElement, name: string) {
  const input =
    container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new File(["zip"], name)],
  });
  await act(
    async () =>
      void input.dispatchEvent(new Event("change", { bubbles: true })),
  );
}
function button(container: HTMLElement, text: string) {
  return [...container.querySelectorAll("button")].find((element) =>
    element.textContent?.includes(text),
  )!;
}

test("latest file parse wins even when an older parse rejects last", async () => {
  const first = deferred<ParsedBundle>();
  const second = deferred<ParsedBundle>();
  const view = await render(
    <ImportRoute
      parseFile={(file) =>
        file.name === "first.zip" ? first.promise : second.promise
      }
    />,
  );
  cleanup = view.unmount;
  await choose(view.container, "first.zip");
  await choose(view.container, "second.zip");
  await act(async () => second.resolve(bundle("New question")));
  await act(async () => first.reject(new Error("Old parse failed")));
  expect(view.container.textContent).toContain("Loaded: second.zip");
  expect(view.container.textContent).toContain("New question");
  expect(view.container.textContent).not.toContain("Parsing bundle...");
});

test("stale deck IDs cannot enable import and saved choices survive hydration", async () => {
  localStorage.setItem(
    "bundle-import-selected-decks",
    JSON.stringify(["hydrate-deck"]),
  );
  const view = await render(<ImportRoute parseFile={async () => bundle()} />);
  cleanup = view.unmount;
  await choose(view.container, "cards.zip");
  expect(button(view.container, "Import 1 Cards").disabled).toBe(true);
  expect(localStorage.getItem("bundle-import-selected-decks")).toBe(
    '["hydrate-deck"]',
  );
  await act(async () => {
    MemoryDB.getSnapshot().putDeck({
      id: "hydrate-deck",
      name: "Loaded deck",
      description: "",
      deleted: false,
      lastModified: 1,
    });
    MemoryDB.notify();
  });
  expect(button(view.container, "Import 1 Cards").disabled).toBe(false);
  await act(async () => {
    MemoryDB.getSnapshot().putDeck({
      id: "hydrate-deck",
      name: "Loaded deck",
      description: "",
      deleted: true,
      lastModified: 2,
    });
    MemoryDB.notify();
  });
  expect(button(view.container, "Import 1 Cards").disabled).toBe(true);
});

test("import locks before fingerprint await and rejects file changes until completion", async () => {
  let hold = false;
  let parses = 0;
  let writes = 0;
  const pending = deferred<string>();
  const view = await render(
    <ImportRoute
      parseFile={async () => {
        parses++;
        return bundle();
      }}
      fingerprintCard={async () => (hold ? pending.promise : "fingerprint")}
      persistCard={async () => {
        writes++;
        return "new-card";
      }}
    />,
  );
  cleanup = view.unmount;
  await choose(view.container, "original.zip");
  await click(button(view.container, "Allow import without decks"));
  hold = true;
  const start = button(view.container, "Import 1 Cards");
  await act(async () => {
    start.click();
    start.click();
  });
  expect(button(view.container, "Importing...").disabled).toBe(true);
  expect(button(view.container, "Create duplicates").disabled).toBe(true);
  expect(
    view.container.querySelector<HTMLInputElement>('input[type="file"]')!
      .disabled,
  ).toBe(true);
  await choose(view.container, "replacement.zip");
  expect(parses).toBe(1);
  expect(writes).toBe(0);
  await act(async () => pending.resolve("fingerprint"));
  expect(writes).toBe(1);
  expect(view.container.textContent).toContain("Imported: 1");
});

test("file chooser has a name and keyboard activation", async () => {
  const view = await render(<ImportRoute />);
  cleanup = view.unmount;
  const chooser = view.container.querySelector<HTMLElement>('[role="button"]')!;
  let clicks = 0;
  view.container
    .querySelector('input[type="file"]')!
    .addEventListener("click", () => {
      clicks++;
    });
  expect(chooser.tabIndex).toBe(0);
  expect(chooser.getAttribute("aria-label")).toBe("Select a bundle zip file");
  await act(
    async () =>
      void chooser.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
  );
  await act(
    async () =>
      void chooser.dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", bubbles: true }),
      ),
  );
  expect(clicks).toBe(2);
});
