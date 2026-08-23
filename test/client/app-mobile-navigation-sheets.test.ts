import { AppMobileNavigationSheets } from "@/components/AppMobileNavigationSheets";
import type { RecentlyReadBook } from "@/lib/library-sort";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const recentReading: RecentlyReadBook = {
  book: {
    id: "book-1",
    fileHash: "epub-hash",
    title: "Book One",
    author: "Author One",
    fileSize: 100,
    dateAdded: 1,
    metadata: {},
    manifest: [],
    spine: [],
    toc: [],
    isDownloaded: 1,
    coverContentHash: "cover-hash",
    _hlc: "1-0-device",
    _deviceId: "device",
    _isDeleted: 0,
    _serverTimestamp: 1,
  },
  lastRead: Date.now(),
};

function renderSheets() {
  const onClose = vi.fn();
  const onSignOut = vi.fn(async () => undefined);
  const onAppearanceChange = vi.fn();
  const onAddBook = vi.fn();

  render(
    createElement(
      MemoryRouter,
      null,
      createElement(AppMobileNavigationSheets, {
        isOpen: true,
        onClose,
        activePath: "/",
        recentReading,
        recentBookCoverUrl: "blob:cover",
        appearanceMode: "system",
        onAppearanceChange,
        isImporting: false,
        onAddBook,
        isOnline: true,
        isSyncing: false,
        onSync: vi.fn(async () => undefined),
        isAuthenticated: true,
        isAuthLoading: false,
        user: {
          name: "Jane Reader",
          email: "jane@example.com",
          image: null,
        },
        onSignIn: vi.fn(async () => undefined),
        onSignOut,
      }),
    ),
  );

  return { onAddBook, onAppearanceChange, onClose, onSignOut };
}

afterEach(cleanup);

describe("AppMobileNavigationSheets", () => {
  it("uses a circular cover for the continuation target", () => {
    renderSheets();

    const continueLink = screen.getByRole("link", {
      name: "Continue reading Book One",
    });
    const cover = continueLink.querySelector("img");

    expect(cover?.parentElement?.classList.contains("rounded-full")).toBe(true);
    expect(continueLink.textContent).not.toContain("00");
    expect(screen.getAllByText("Reader")).toHaveLength(1);
  });

  it("keeps utility actions separate from the navigation rows", () => {
    const { onAddBook, onAppearanceChange, onClose } = renderSheets();

    const libraryLink = screen.getByRole("link", { name: /01 Library/ });
    expect(libraryLink).toBeTruthy();
    expect(screen.getByRole("link", { name: /02 Highlights/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /03 Sessions/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /04 Performance/ })).toBeTruthy();
    expect(screen.queryByText("05")).toBeNull();

    const appearanceButton = screen.getByRole("button", {
      name: "Switch appearance. Current setting: System",
    });

    fireEvent.click(appearanceButton);
    fireEvent.click(screen.getByRole("button", { name: "Add book" }));
    fireEvent.click(libraryLink);

    expect(onAppearanceChange).toHaveBeenCalledWith("light");
    expect(onAddBook).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("opens account actions as a peer sheet and returns to navigation", async () => {
    renderSheets();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Jane Reader, jane@example.com",
      }),
    );

    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Account" })).toBeTruthy(),
    );
    expect(screen.getByRole("link", { name: /01 Devices/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /02 Sync now/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /03 Sign out/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Back to navigation" }));

    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Reader" })).toBeTruthy(),
    );
  });
});
