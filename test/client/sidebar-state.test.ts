import {
  Sidebar,
  SidebarFloatingTrigger,
  SidebarHeader,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  ReaderSettingsProvider,
  useReaderSettings,
} from "@/hooks/use-reader-settings";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalMatchMedia = window.matchMedia;

function createMediaQueryList(query: string): MediaQueryList {
  return {
    media: query,
    matches: false,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  };
}

function SidebarProbe() {
  const { open, toggleSidebar } = useSidebar();
  return createElement(
    "button",
    { type: "button", onClick: toggleSidebar },
    open ? "open" : "closed",
  );
}

function ThemeProbe({ label }: { label: string }) {
  const { settings, updateSettings } = useReaderSettings();
  return createElement(
    "button",
    {
      type: "button",
      "aria-label": label,
      onClick: () => updateSettings({ theme: "dark" }),
    },
    settings.theme,
  );
}

beforeEach(() => {
  window.matchMedia = vi.fn(createMediaQueryList);
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
  document.documentElement.classList.remove("dark", "theme-transitioning");
});

describe("SidebarProvider", () => {
  it("toggles the desktop sidebar with Command+Backslash", () => {
    render(
      createElement(
        SidebarProvider,
        { defaultOpen: true },
        createElement(SidebarProbe),
      ),
    );

    expect(screen.getByRole("button").textContent).toBe("open");

    fireEvent.keyDown(window, {
      code: "Backslash",
      key: "\\",
      metaKey: true,
    });

    expect(screen.getByRole("button").textContent).toBe("closed");
  });

  it("reports controlled changes to the app shell", () => {
    const onOpenChange = vi.fn();
    render(
      createElement(
        SidebarProvider,
        { open: true, onOpenChange },
        createElement(SidebarProbe),
      ),
    );

    fireEvent.click(screen.getByRole("button"));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("exposes only one visible sidebar control at a time", () => {
    render(
      createElement(
        SidebarProvider,
        null,
        createElement(
          Sidebar,
          null,
          createElement(SidebarHeader, null, createElement(SidebarTrigger)),
        ),
        createElement(SidebarFloatingTrigger),
      ),
    );

    expect(
      screen.getAllByRole("button", { name: "Toggle sidebar" }),
    ).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Toggle sidebar" }));

    expect(
      screen.getAllByRole("button", { name: "Toggle sidebar" }),
    ).toHaveLength(1);
  });
});

describe("ReaderSettingsProvider", () => {
  it("shares one settings snapshot across consumers", () => {
    render(
      createElement(
        ReaderSettingsProvider,
        null,
        createElement(ThemeProbe, { label: "first" }),
        createElement(ThemeProbe, { label: "second" }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "first" }));

    expect(screen.getByRole("button", { name: "first" }).textContent).toBe(
      "dark",
    );
    expect(screen.getByRole("button", { name: "second" }).textContent).toBe(
      "dark",
    );
  });
});
