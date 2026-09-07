import { expect, test } from "bun:test";
import { act } from "react";
import { createEmptyCard } from "ts-fsrs";
import { click, input, render } from "../../../tests/dom";
import EditFlashcardResponsive from "./edit-flashcard-responsive";
import type { CardWithMetadata } from "@/lib/types";

Object.assign(globalThis, { NodeFilter: window.NodeFilter });
const card: CardWithMetadata = {
  ...createEmptyCard(),
  id: "edit-card",
  front: "Original question",
  back: "Original answer",
  deleted: false,
  bookmarked: false,
  cardLastModified: 0,
  cardContentLastModified: 0,
  cardDeletedLastModified: 0,
  cardBookmarkedLastModified: 0,
  cardSuspendedLastModified: 0,
  cardMetadataLastModified: 0,
  createdAt: 0,
};

test("editor keeps draft across responsive remounts and discards it on cancel", async () => {
  const originalMatchMedia = window.matchMedia;
  let mobile = false;
  const listeners = new Set<EventListener>();
  window.matchMedia = (query) =>
    ({
      matches: mobile,
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: EventListener) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: EventListener) => {
        listeners.delete(listener);
      },
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    }) as MediaQueryList;
  const props = { card, onEdit: async () => {}, onOpenChange: () => {} };
  const view = await render(<EditFlashcardResponsive {...props} open />);
  try {
    await input(document.querySelector("textarea")!, "Unsaved draft");
    await act(async () => {
      mobile = true;
      [...listeners].forEach((listener) => listener(new Event("change")));
    });
    expect(document.querySelector("textarea")!.value).toBe("Unsaved draft");
    await act(async () => {
      mobile = false;
      [...listeners].forEach((listener) => listener(new Event("change")));
    });
    expect(document.querySelector("textarea")!.value).toBe("Unsaved draft");
    await view.rerender(<EditFlashcardResponsive {...props} open={false} />);
    await view.rerender(<EditFlashcardResponsive {...props} open />);
    expect(document.querySelector("textarea")!.value).toBe("Original question");
    await view.rerender(<EditFlashcardResponsive {...props} open={false} />);
    await view.rerender(
      <EditFlashcardResponsive
        {...props}
        card={{ ...card, id: "other-card", front: "Other question" }}
        open
      />,
    );
    expect(document.querySelector("textarea")!.value).toBe("Other question");
  } finally {
    await view.unmount();
    window.matchMedia = originalMatchMedia;
  }
});

test("editor footer cannot mutate a card while its text save is pending", async () => {
  let finish!: () => void;
  const save = new Promise<void>((resolve) => { finish = resolve; });
  let mutations = 0;
  const view = await render(
    <EditFlashcardResponsive
      card={card}
      open
      onEdit={() => save}
      onOpenChange={() => {}}
      actions={{
        bookmarked: false,
        onBookmark: () => { mutations++; },
        onBury: () => { mutations++; },
        onDelete: () => { mutations++; },
      }}
    />,
  );
  try {
    await act(async () => {
      document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    const footer = document.querySelector("fieldset.border-t") as HTMLFieldSetElement;
    expect(footer.disabled).toBe(true);
    for (const button of footer.querySelectorAll("button")) await click(button);
    expect(mutations).toBe(0);
    await act(async () => { finish(); await save; });
    expect(footer.disabled).toBe(false);
    await click(footer.querySelector("button")!);
    expect(mutations).toBe(1);
  } finally {
    finish();
    await view.unmount();
  }
});
