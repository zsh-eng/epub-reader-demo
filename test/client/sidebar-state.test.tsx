import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import {
  ReaderSettingsProvider,
  useReaderSettings,
} from "@/hooks/use-reader-settings";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  return (
    <button type="button" onClick={toggleSidebar}>
      {open ? "open" : "closed"}
    </button>
  );
}

function ThemeProbe({ label }: { label: string }) {
  const { settings, updateSettings } = useReaderSettings();
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => updateSettings({ theme: "dark" })}
    >
      {settings.theme}
    </button>
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
      <SidebarProvider defaultOpen>
        <SidebarProbe />
      </SidebarProvider>,
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
      <SidebarProvider open onOpenChange={onOpenChange}>
        <SidebarProbe />
      </SidebarProvider>,
    );

    fireEvent.click(screen.getByRole("button"));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("ReaderSettingsProvider", () => {
  it("shares one settings snapshot across consumers", () => {
    render(
      <ReaderSettingsProvider>
        <ThemeProbe label="first" />
        <ThemeProbe label="second" />
      </ReaderSettingsProvider>,
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
