import { ReaderControlMenu } from "@/components/Reader/ReaderControlMenu";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

describe("ReaderControlMenu", () => {
  it("opens the book-status sheet from reader tools", () => {
    const onOpenBookActions = vi.fn();

    render(
      createElement(ReaderControlMenu, {
        onOpenContents: vi.fn(),
        onOpenBookActions,
        onOpenSettings: vi.fn(),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /Book Status/ }));

    expect(onOpenBookActions).toHaveBeenCalledOnce();
  });
});
