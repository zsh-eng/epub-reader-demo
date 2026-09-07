import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { render, input } from "../../tests/dom";
import { CreateUpdateFlashcardForm } from "./create-flashcard";
import CreateDeckForm from "./create-deck-form";
import { deckFormSchema } from "@/lib/form-schema";

Object.assign(globalThis, { NodeFilter: window.NodeFilter });

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
  localStorage.clear();
});
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}

test("card submit retains text on failure, blocks repeats, and clears only after success", async () => {
  let pending = deferred();
  let calls = 0;
  const view = await render(
    <CreateUpdateFlashcardForm
      onSubmit={() => {
        calls++;
        return pending.promise;
      }}
    />,
  );
  cleanup = view.unmount;
  const [front, back] = [...view.container.querySelectorAll("textarea")];
  await input(front, "Question");
  await input(back, "Answer");
  const form = view.container.querySelector("form")!;
  await submit(form);
  await submit(form);
  expect(calls).toBe(1);
  expect(front.value).toBe("Question");
  expect(
    JSON.parse(localStorage.getItem("create-flashcard-draft")!).front,
  ).toBe("Question");
  expect(view.container.querySelector("fieldset")!.disabled).toBe(true);
  await act(async () => pending.reject(new Error("Storage unavailable")));
  expect(front.value).toBe("Question");
  expect(view.container.querySelector('[role="alert"]')?.textContent).toContain(
    "Your text is kept",
  );
  pending = deferred();
  await submit(form);
  expect(calls).toBe(2);
  expect(front.value).toBe("Question");
  await act(async () => pending.resolve());
  expect(front.value).toBe("");
  expect(back.value).toBe("");
  expect(localStorage.getItem("create-flashcard-draft")).toBeNull();
});

test("Cmd+Enter only submits the form containing the event target", async () => {
  let calls = 0;
  const view = await render(
    <>
      <CreateUpdateFlashcardForm
        onSubmit={() => {
          calls++;
        }}
      />
      <div role="dialog">
        <input aria-label="Deck name" />
      </div>
    </>,
  );
  cleanup = view.unmount;
  const [front, back] = [...view.container.querySelectorAll("textarea")];
  await input(front, "Question");
  await input(back, "Answer");
  await act(
    async () =>
      void view.container.querySelector("input")!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          metaKey: true,
          bubbles: true,
        }),
      ),
  );
  expect(calls).toBe(0);
  expect(front.value).toBe("Question");
  await act(
    async () =>
      void front.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          metaKey: true,
          bubbles: true,
        }),
      ),
  );
  expect(calls).toBe(1);
});

test("blank deck description is valid but name and length limits remain enforced", () => {
  expect(
    deckFormSchema.safeParse({ name: "A-B", description: "" }).success,
  ).toBe(true);
  expect(deckFormSchema.safeParse({ name: "", description: "" }).success).toBe(
    false,
  );
  expect(
    deckFormSchema.safeParse({ name: "Deck", description: "x".repeat(301) })
      .success,
  ).toBe(false);
});

test("deck form waits for persistence and retains input after a failed write", async () => {
  let pending = deferred();
  let closes = 0;
  let calls = 0;
  const view = await render(
    <CreateDeckForm
      open
      onOpenChange={() => {
        closes++;
      }}
      persistDeck={async () => {
        calls++;
        await pending.promise;
      }}
    />,
  );
  cleanup = view.unmount;
  const name = document.querySelector<HTMLInputElement>(
    'input[placeholder="Enter deck name"]',
  )!;
  await input(name, "New deck");
  const form = name.closest("form")!;
  await submit(form);
  await submit(form);
  expect(calls).toBe(1);
  expect(closes).toBe(0);
  await act(async () => pending.reject(new Error("Write failed")));
  expect(name.value).toBe("New deck");
  expect(closes).toBe(0);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "Your text is kept",
  );
  pending = deferred();
  await submit(form);
  await act(async () => pending.resolve());
  expect(closes).toBe(1);
  expect(name.value).toBe("");
});
