import { expect, test } from "bun:test";
import { render, click } from "../../tests/dom";
import FlashcardTable from "./cards-table";
import { defaultCard } from "@/lib/sync/default";

Object.assign(globalThis, { NodeFilter: window.NodeFilter });

test("each table row exposes a named native edit button for its card", async () => {
  const view = await render(
    <FlashcardTable
      cards={[
        {
          ...defaultCard,
          id: "table-first",
          front: "First question",
          back: "First answer",
        },
        {
          ...defaultCard,
          id: "table-second",
          front: "Second question",
          back: "Second answer",
        },
      ]}
    />,
  );
  try {
    const control = view.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Edit flashcard: Second question"]',
    )!;
    expect(control.type).toBe("button");
    expect(control.tabIndex).toBe(0);
    await click(control);
    expect(document.querySelector("textarea")!.value).toBe("Second question");
  } finally {
    await view.unmount();
  }
});
