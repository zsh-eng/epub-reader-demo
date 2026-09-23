import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

describe("DropdownMenu layering", () => {
  it("keeps portalled actions above the floating sidebar", () => {
    const onSignOut = vi.fn();

    render(
      createElement(
        DropdownMenu,
        { defaultOpen: true },
        createElement(
          DropdownMenuTrigger,
          { render: createElement("button", { type: "button" }) },
          "Account",
        ),
        createElement(
          DropdownMenuContent,
          { side: "right" },
          createElement(
            DropdownMenuItem,
            { onClick: onSignOut },
            "Sign out",
          ),
        ),
      ),
    );

    const positioner = document.querySelector(
      '[data-slot="dropdown-menu-positioner"]',
    );
    expect(positioner?.classList.contains("z-50")).toBe(true);

    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));

    expect(onSignOut).toHaveBeenCalledOnce();
  });
});
