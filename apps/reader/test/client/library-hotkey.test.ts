import { Library } from "@/features/library/Library";
import { SidebarProvider } from "@/components/ui/sidebar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/AppShell", () => ({
  useAppShellReady: vi.fn(),
}));

vi.mock("@/features/library/BookCard", () => ({
  BookCard: () => null,
}));

vi.mock("@/features/reader/data/reader-cache/prefetch", () => ({
  prefetchReaderBook: vi.fn(),
  prefetchReaderBooks: vi.fn(),
}));

vi.mock("@/hooks/use-books-with-statuses", () => ({
  useBooksWithStatuses: () => ({
    data: {
      categorized: {
        continueReading: [],
        library: [],
        finished: [],
      },
      statuses: new Map(),
    },
  }),
}));

vi.mock("@/features/library/use-epub-import", () => ({
  useEpubImport: () => ({
    importFiles: vi.fn(),
    isProcessing: false,
    openFilePicker: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-library-cover-urls", () => ({
  useLibraryCoverUrls: () => ({
    coverUrls: new Map(),
    initialCoversReady: true,
    requestCover: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-reader-settings", () => ({
  useReaderSettings: () => ({
    settings: {
      publisherBookStylingEnabled: false,
      matchPublisherBodyTextSize: false,
      pageAnimationsEnabled: true,
      showPageNumbers: true,
    },
  }),
}));

vi.mock("@/hooks/use-sync", () => ({
  useSync: () => ({ deleteBook: vi.fn() }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Library hotkeys", () => {
  it("focuses search with Slash without taking focus from another input", () => {
    const queryClient = new QueryClient();
    render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          MemoryRouter,
          null,
          createElement(SidebarProvider, null, createElement(Library)),
        ),
      ),
    );
    const searchInput = screen.getByRole<HTMLInputElement>("searchbox", {
      name: "Search library",
    });

    fireEvent.keyDown(document, { code: "Slash", key: "/" });
    expect(document.activeElement).toBe(searchInput);

    fireEvent.keyUp(document, { code: "Slash", key: "/" });
    const otherInput = document.createElement("input");
    document.body.append(otherInput);
    otherInput.focus();

    fireEvent.keyDown(otherInput, { code: "Slash", key: "/" });
    expect(document.activeElement).toBe(otherInput);

    otherInput.remove();
  });

  it("keeps the mobile navigation trigger in the search row", () => {
    const queryClient = new QueryClient();
    render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          MemoryRouter,
          null,
          createElement(SidebarProvider, null, createElement(Library)),
        ),
      ),
    );

    const searchInput = screen.getByRole("searchbox", {
      name: "Search library",
    });
    const navigationTrigger = screen.getByRole("button", {
      name: "Open navigation",
    });

    expect(searchInput.parentElement?.parentElement?.parentElement).toBe(
      navigationTrigger.parentElement,
    );
  });
});
