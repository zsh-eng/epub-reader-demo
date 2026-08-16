import { SmoothCaretInput } from "@/components/ui/smooth-caret-input";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

function rect(left: number): DOMRect {
  return {
    bottom: 20,
    height: 20,
    left,
    right: left,
    top: 0,
    width: 0,
    x: left,
    y: 0,
    toJSON: () => ({}),
  };
}

function ControlledInput() {
  const [value, setValue] = useState("");
  return createElement(SmoothCaretInput, {
    "aria-label": "Library search",
    value,
    onChange: (event) => setValue(event.target.value),
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SmoothCaretInput", () => {
  it("preserves native controlled-input behavior", () => {
    render(createElement(ControlledInput));
    const input = screen.getByRole("textbox", { name: "Library search" });

    fireEvent.change(input, { target: { value: "reader" } });

    expect((input as HTMLInputElement).value).toBe("reader");
  });

  it("positions the custom caret from the collapsed selection", () => {
    render(
      createElement(SmoothCaretInput, {
        "aria-label": "Library search",
        className: "text-xl",
        value: "reader",
        onChange: () => undefined,
      }),
    );

    const input = screen.getByRole<HTMLInputElement>("textbox", {
      name: "Library search",
    });
    const mirror = document.querySelector<HTMLElement>(
      '[data-slot="smooth-caret-mirror"]',
    );
    const marker = mirror?.lastElementChild as HTMLElement;
    if (!mirror || !marker) throw new Error("Caret mirror was not rendered");

    mirror.getBoundingClientRect = () => rect(10);
    marker.getBoundingClientRect = () =>
      rect(10 + (mirror.textContent?.length ?? 0) * 12);
    Object.defineProperty(input, "clientWidth", {
      configurable: true,
      value: 240,
    });
    Object.defineProperty(input, "scrollLeft", {
      configurable: true,
      value: 7,
      writable: true,
    });

    input.focus();
    input.setSelectionRange(3, 3);
    fireEvent.select(input);

    const inputStyle = window.getComputedStyle(input);
    const inlineStart =
      (Number.parseFloat(inputStyle.borderLeftWidth) || 0) +
      (Number.parseFloat(inputStyle.paddingLeft) || 0);
    const expectedX = inlineStart + 36 - input.scrollLeft;
    const caret = document.querySelector<HTMLElement>(
      '[data-slot="smooth-caret"]',
    );

    expect(mirror.textContent).toBe("rea");
    expect(caret?.style.transform).toBe(`translate3d(${expectedX}px, -50%, 0)`);
    expect(caret?.classList.contains("opacity-100")).toBe(true);
    expect(input.classList.contains("caret-transparent")).toBe(true);

    input.setSelectionRange(2, 2);
    fireEvent.keyUp(input, { key: "ArrowLeft" });

    expect(caret?.getAttribute("data-motion")).toBe("smooth");
    expect(caret?.classList.contains("motion-reduce:transition-none")).toBe(
      true,
    );
  });

  it("snaps when the pointer places the caret", () => {
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    render(
      createElement(SmoothCaretInput, {
        "aria-label": "Library search",
        value: "reader",
        onChange: () => undefined,
      }),
    );

    const input = screen.getByRole<HTMLInputElement>("textbox", {
      name: "Library search",
    });
    input.focus();
    fireEvent.pointerDown(input);
    input.setSelectionRange(2, 2);
    fireEvent.select(input);

    expect(
      document
        .querySelector('[data-slot="smooth-caret"]')
        ?.getAttribute("data-motion"),
    ).toBe("instant");
  });

  it("hides the custom caret for a range selection", () => {
    render(
      createElement(SmoothCaretInput, {
        "aria-label": "Library search",
        value: "reader",
        onChange: () => undefined,
      }),
    );

    const input = screen.getByRole<HTMLInputElement>("textbox", {
      name: "Library search",
    });
    input.focus();
    input.setSelectionRange(1, 4);
    fireEvent.select(input);

    expect(
      document
        .querySelector('[data-slot="smooth-caret"]')
        ?.classList.contains("opacity-0"),
    ).toBe(true);
  });

  it("keeps the full caret inside an overflowing input", () => {
    render(
      createElement(SmoothCaretInput, {
        "aria-label": "Library search",
        value: "A long search query",
        onChange: () => undefined,
      }),
    );

    const input = screen.getByRole<HTMLInputElement>("textbox", {
      name: "Library search",
    });
    const mirror = document.querySelector<HTMLElement>(
      '[data-slot="smooth-caret-mirror"]',
    );
    const marker = mirror?.lastElementChild as HTMLElement;
    if (!mirror || !marker) throw new Error("Caret mirror was not rendered");

    mirror.getBoundingClientRect = () => rect(0);
    marker.getBoundingClientRect = () => rect(500);
    Object.defineProperty(input, "clientWidth", {
      configurable: true,
      value: 200,
    });

    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    fireEvent.select(input);

    const inputStyle = window.getComputedStyle(input);
    const inlineEnd =
      (Number.parseFloat(inputStyle.borderRightWidth) || 0) +
      (Number.parseFloat(inputStyle.paddingRight) || 0);
    const caret = document.querySelector<HTMLElement>(
      '[data-slot="smooth-caret"]',
    );
    expect(caret?.style.transform).toBe(
      `translate3d(${input.clientWidth - inlineEnd - 2}px, -50%, 0)`,
    );
  });

  it("restores the native caret during text composition", () => {
    render(
      createElement(SmoothCaretInput, {
        "aria-label": "Library search",
        value: "reader",
        onChange: () => undefined,
      }),
    );

    const input = screen.getByRole<HTMLInputElement>("textbox", {
      name: "Library search",
    });
    input.focus();
    fireEvent.compositionStart(input);

    expect(input.classList.contains("caret-transparent")).toBe(false);
    expect(
      document
        .querySelector('[data-slot="smooth-caret"]')
        ?.classList.contains("opacity-0"),
    ).toBe(true);
  });
});
