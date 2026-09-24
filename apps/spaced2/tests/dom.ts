import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

export async function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return {
    container,
    async rerender(next: ReactNode) { await act(async () => root.render(next)); },
    async unmount() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

export async function input(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export async function click(element: HTMLElement) {
  await act(async () => element.click());
}
